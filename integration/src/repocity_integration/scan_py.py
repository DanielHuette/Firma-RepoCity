"""Database calls of the RadarAuditor worker, read from its Python repositories with ast.

Context: The worker reaches the database through supabase-py with the service key: self._client
for schema public, self._crm() for schema crm. Rows written are dict literals, dicts built up in the
function, or pydantic models dumped with include or exclude. | Input: repository modules and the
model modules. | Output: Reference values, one per table or rpc call.
"""

import ast
from collections.abc import Iterator
from dataclasses import dataclass, field, replace

from repocity_integration.references import Reference, column_of, parse_select

FILTERS = {
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "like",
    "ilike",
    "is_",
    "in_",
    "contains",
    "order",
    "filter",
    "not_",
}
WRITES = {"insert": "insert", "update": "update", "upsert": "upsert", "delete": "delete"}
ROLE = "service_role"


def model_fields(sources: list[str]) -> dict[str, set[str]]:
    """Field names of every pydantic model class, inherited fields included."""
    own: dict[str, set[str]] = {}
    bases: dict[str, list[str]] = {}
    for source in sources:
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.ClassDef):
                own[node.name] = {
                    t.target.id
                    for t in node.body
                    if isinstance(t, ast.AnnAssign) and isinstance(t.target, ast.Name)
                }
                bases[node.name] = [b.id for b in node.bases if isinstance(b, ast.Name)]

    def resolved(name: str) -> set[str]:
        return own.get(name, set()).union(*(resolved(base) for base in bases.get(name, [])))

    return {name: resolved(name) for name in own}


@dataclass
class Module:
    """One module with its constants, models and parent links."""

    relative: str
    tree: ast.Module
    models: dict[str, set[str]]
    constants: dict[str, str] = field(default_factory=dict)
    parents: dict[ast.AST, ast.AST] = field(default_factory=dict)

    def __post_init__(self) -> None:
        """Read module constants and link every node to its parent."""
        for node in self.tree.body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1:
                target = node.targets[0]
                if isinstance(target, ast.Name) and isinstance(node.value, ast.Constant):
                    if isinstance(node.value.value, str):
                        self.constants[target.id] = node.value.value
        for parent in ast.walk(self.tree):
            for child in ast.iter_child_nodes(parent):
                self.parents[child] = parent

    def string(self, node: ast.AST, bindings: dict[str, str]) -> str | None:
        """Value of a string constant, a module constant or a bound parameter."""
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, ast.Name):
            return bindings.get(node.id, self.constants.get(node.id))
        return None


def _schema_of(module: Module, receiver: ast.AST) -> str | None:
    text = ast.unparse(receiver)
    if text == "self._client":
        return "public"
    if text == "self._crm()":
        return "crm"
    if isinstance(receiver, ast.Call) and text.startswith("self._client.schema("):
        return module.string(receiver.args[0], {})
    return None


def _calls_after(module: Module, node: ast.Call) -> list[ast.Call]:
    """The calls chained onto node: .select(...).eq(...) and so on."""
    calls: list[ast.Call] = []
    current: ast.AST = node
    while True:
        attribute = module.parents.get(current)
        call = module.parents.get(attribute) if isinstance(attribute, ast.Attribute) else None
        if not isinstance(call, ast.Call) or call.func is not attribute:
            return calls
        calls.append(call)
        current = call


def _function_of(module: Module, node: ast.AST) -> ast.FunctionDef | None:
    current: ast.AST | None = node
    while current is not None and not isinstance(current, ast.FunctionDef):
        current = module.parents.get(current)
    return current


def _set_literal(node: ast.AST | None) -> set[str] | None:
    if isinstance(node, ast.Set):
        return {
            e.value for e in node.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)
        }
    return None


def _annotation_class(function: ast.FunctionDef, name: str) -> str | None:
    """Class of a parameter annotated Model, list[Model] or Sequence[Model]."""
    for argument in function.args.args:
        if argument.arg == name and argument.annotation is not None:
            annotation = argument.annotation
            if isinstance(annotation, ast.Subscript):
                annotation = annotation.slice
            return annotation.id if isinstance(annotation, ast.Name) else None
    return None


def _dump_keys(module: Module, function: ast.FunctionDef, call: ast.Call) -> set[str] | None:
    """Keys of model.model_dump(include=..., exclude=...)."""
    if not (isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Name)):
        return None
    owner = call.func.value.id
    model = _annotation_class(function, owner) or _loop_class(module, function, owner)
    fields = module.models.get(model or "")
    if fields is None:
        return None
    options = {k.arg: k.value for k in call.keywords}
    include, exclude = _set_literal(options.get("include")), _set_literal(options.get("exclude"))
    return (fields & include if include is not None else fields) - (exclude or set())


def _loop_class(module: Module, function: ast.FunctionDef, name: str) -> str | None:
    """Class of the variable of a comprehension: for name in <parameter annotated list[Model]>."""
    for node in ast.walk(function):
        if isinstance(node, ast.comprehension) and isinstance(node.target, ast.Name):
            if node.target.id == name and isinstance(node.iter, ast.Name):
                return _annotation_class(function, node.iter.id)
    return None


def _dict_keys(node: ast.Dict) -> set[str] | None:
    keys = {k.value for k in node.keys if isinstance(k, ast.Constant) and isinstance(k.value, str)}
    return None if None in node.keys else keys


def _assigned_keys(module: Module, function: ast.FunctionDef, name: str) -> set[str] | None:
    """Keys a variable holds: its assigned value plus every name["key"] = ... in the function."""
    keys: set[str] | None = None
    for node in ast.walk(function):
        value = node.value if isinstance(node, (ast.Assign, ast.AnnAssign)) else None
        targets = (
            node.targets
            if isinstance(node, ast.Assign)
            else [node.target]
            if isinstance(node, ast.AnnAssign)
            else []
        )
        if value is not None and any(isinstance(t, ast.Name) and t.id == name for t in targets):
            keys = payload_keys(module, function, value)
        for target in targets:
            if (
                isinstance(target, ast.Subscript)
                and isinstance(target.value, ast.Name)
                and target.value.id == name
            ):
                key = module.string(target.slice, {})
                keys = None if keys is None or key is None else keys | {key}
    return keys


def payload_keys(module: Module, function: ast.FunctionDef, node: ast.AST) -> set[str] | None:
    """Keys of a written row (or list of rows), or None when they cannot be read statically."""
    if isinstance(node, ast.Dict):
        return _dict_keys(node)
    if isinstance(node, ast.ListComp):
        return payload_keys(module, function, node.elt)
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "model_dump"
    ):
        return _dump_keys(module, function, node)
    if isinstance(node, ast.Name):
        return _assigned_keys(module, function, node.id)
    if isinstance(node, ast.DictComp):
        return _comprehension_keys(module, function, node.generators[0].iter)
    return None


def _comprehension_keys(
    module: Module, function: ast.FunctionDef, source: ast.AST
) -> set[str] | None:
    """Keys of {key: value for key, value in <pairs or a dict's items()> if ...}."""
    if isinstance(source, (ast.Tuple, ast.List)):
        firsts = [e.elts[0] for e in source.elts if isinstance(e, ast.Tuple) and e.elts]
        keys = {module.string(first, {}) for first in firsts}
        return None if None in keys or len(firsts) != len(source.elts) else {k for k in keys if k}
    if (
        isinstance(source, ast.Call)
        and isinstance(source.func, ast.Attribute)
        and source.func.attr == "items"
    ):
        return payload_keys(module, function, source.func.value)
    return None


def _apply(
    module: Module,
    function: ast.FunctionDef,
    reference: Reference,
    call: ast.Call,
    bindings: dict[str, str],
) -> Reference:
    method = call.func.attr if isinstance(call.func, ast.Attribute) else ""
    first = module.string(call.args[0], bindings) if call.args else None
    if method == "select" and first is not None:
        selected = parse_select(first)
        return replace(
            reference.with_columns(selected.columns),
            embeds=reference.embeds + tuple(selected.embeds),
        )
    if method in FILTERS and first is not None:
        return reference.with_columns({column_of(first)})
    if method not in WRITES:
        return reference
    written = replace(reference, action=WRITES[method])
    conflict = next(
        (module.string(k.value, bindings) for k in call.keywords if k.arg == "on_conflict"), None
    )
    written = replace(written, conflict=tuple(conflict.split(",")) if conflict else ())
    if method == "delete":
        return written
    keys = payload_keys(module, function, call.args[0])
    if keys is None:
        return replace(written, unresolved=f"payload {ast.unparse(call.args[0])[:60]}")
    return written.with_columns(keys)


def _start(
    module: Module, call: ast.Call, schema: str, bindings: dict[str, str], function: ast.FunctionDef
) -> Reference:
    method = call.func.attr if isinstance(call.func, ast.Attribute) else ""
    name = module.string(call.args[0], bindings) or "?"
    location = f"{module.relative}:{call.lineno}"
    if method == "table":
        return Reference(
            location,
            ROLE,
            schema,
            "table",
            name,
            unresolved="" if name != "?" else f"name {ast.unparse(call.args[0])}",
        )
    keys = payload_keys(module, function, call.args[1]) if len(call.args) > 1 else set()
    return Reference(
        location,
        ROLE,
        schema,
        "rpc",
        name,
        "execute",
        frozenset(keys or ()),
        unresolved="" if keys is not None else "arguments",
    )


def _bindings(module: Module, function: ast.FunctionDef, call: ast.Call) -> list[dict[str, str]]:
    """Literal values of the parameters a call uses as names, one dict per call site."""
    parameters = [a.arg for a in function.args.args]
    if not (call.args and isinstance(call.args[0], ast.Name) and call.args[0].id in parameters):
        return [{}]
    sites: list[dict[str, str]] = []
    for node in ast.walk(module.tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == function.name
        ):
            values = [module.string(a, {}) for a in node.args]
            sites.append(
                {p: v for p, v in zip(parameters[1:], values, strict=False) if v is not None}
            )
    return sites or [{}]


def _variable_calls(module: Module, function: ast.FunctionDef, name: str) -> list[ast.Call]:
    """Calls chained onto a variable later in the function: query = query.eq(...)."""
    found: list[ast.Call] = []
    for node in ast.walk(function):
        if (
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id == name
        ):
            call = module.parents.get(node)
            if isinstance(call, ast.Call) and call.func is node:
                found += [call, *_calls_after(module, call)]
    return found


def _assigned_name(module: Module, call: ast.Call) -> str | None:
    parent = module.parents.get(call)
    if (
        isinstance(parent, ast.Assign)
        and len(parent.targets) == 1
        and isinstance(parent.targets[0], ast.Name)
    ):
        return parent.targets[0].id
    return None


def python_references(module: Module) -> Iterator[Reference]:
    """Every table and rpc call of the module."""
    for node in ast.walk(module.tree):
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in ("table", "rpc")
        ):
            continue
        schema = _schema_of(module, node.func.value)
        function = _function_of(module, node)
        if schema is None or function is None or not node.args:
            continue
        calls = _calls_after(module, node)
        variable = _assigned_name(module, calls[-1] if calls else node)
        later = _variable_calls(module, function, variable) if variable else []
        for bindings in _bindings(module, function, node):
            reference = _start(module, node, schema, bindings, function)
            for call in calls + later:
                reference = _apply(module, function, reference, call, bindings)
            yield reference
