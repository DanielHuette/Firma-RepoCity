"""Database calls of the TypeScript callers: three web apps and two Edge Functions.

Context: The apps call supabase-js (from, rpc, schema and the chained filters); the Edge Functions
and the Cockpit service worker build PostgREST paths for small REST helpers. | Input: the source
folders of this repository. | Output: Reference values, one per call, with what could not be read
marked unresolved.
"""

import re
from collections.abc import Iterator
from dataclasses import dataclass, replace

from repocity_integration.references import (
    Reference,
    SelectList,
    column_of,
    parse_rest_path,
    parse_select,
)
from repocity_integration.tsparse import (
    TypeIndex,
    closing,
    object_keys,
    split_top,
    string_value,
)

FILTERS = {
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "like",
    "ilike",
    "is",
    "in",
    "contains",
    "order",
    "not",
    "filter",
    "match",
    "containedBy",
    "overlaps",
    "textSearch",
}
WRITES = {"insert": "insert", "update": "update", "upsert": "upsert", "delete": "delete"}


@dataclass(frozen=True)
class Call:
    """One call of a chain: method name and the text of its arguments."""

    method: str
    arguments: list[str]
    position: int


@dataclass
class TsFile:
    """A source file with what resolving its expressions needs."""

    relative: str
    text: str
    constants: dict[str, str]
    types: TypeIndex
    folder_text: str = ""

    def line(self, position: int) -> str:
        """file:line of a position."""
        return f"{self.relative}:{self.text.count(chr(10), 0, position) + 1}"


def chain(text: str, start: int) -> list[Call]:
    """The calls .a(...).b(...) that follow start, across line breaks and type arguments."""
    calls: list[Call] = []
    index = start
    while True:
        match = re.compile(r"\s*\.\s*(\w+)\s*").match(text, index)
        if match is None:
            return calls
        after = match.end()
        if after < len(text) and text[after] == "<":
            after = closing(text, after, angle=True)
        if after >= len(text) or text[after] != "(":
            return calls
        end = closing(text, after)
        calls.append(Call(match.group(1), split_top(text[after + 1 : end - 1]), match.start()))
        index = end


def enclosing_function(text: str, position: int) -> tuple[str, str]:
    """Name and parameter text of the function declared last before position."""
    found = list(re.finditer(r"function (\w+)\s*(?:<[^>]*>)?\(", text[:position]))
    if not found:
        return "", ""
    match = found[-1]
    return match.group(1), text[match.end() : closing(text, match.end() - 1) - 1]


def parameter_type(parameters: str, name: str) -> str | None:
    """Declared type of a parameter in a parameter list."""
    for parameter in split_top(parameters, angle=True):
        match = re.match(rf"^{name}\??\s*:\s*(.+)$", parameter, re.DOTALL)
        if match is not None:
            return match.group(1).strip()
    return None


def instantiations(file: TsFile, position: int, value: str) -> list[dict[str, str]]:
    """For a parameter used as table or column name: its literal values at every call site."""
    function, parameters = enclosing_function(file.text, position)
    names = [re.split(r"[?:]", p)[0].strip() for p in split_top(parameters, angle=True)]
    if value not in names:
        return []
    found: list[dict[str, str]] = []
    for site in re.finditer(rf"(?<![\w.]){function}\(", file.text):
        arguments = split_top(file.text[site.end() : closing(file.text, site.end() - 1) - 1])
        literals = [string_value(a, file.constants) for a in arguments]
        bound = {n: v for n, v in zip(names, literals, strict=False) if v is not None}
        if value in bound:
            found.append(bound)
    return found


def _bindings_for(file: TsFile, position: int, expressions: list[str]) -> list[dict[str, str]]:
    """One binding per call site when a name argument is a parameter; one empty binding else."""
    for expression in expressions:
        if string_value(expression, file.constants) is None and re.fullmatch(r"\w+", expression):
            found = instantiations(file, position, expression)
            if found:
                return found
    return [{}]


def _local_assignment(file: TsFile, position: int, name: str) -> str | None:
    function_start = max(file.text.rfind("function ", 0, position), 0)
    found = list(re.finditer(rf"const {name} = ", file.text[function_start:position]))
    if not found:
        return None
    start = function_start + found[-1].end()
    return file.text[start : _expression_end(file.text, start)]


def _expression_end(text: str, start: int) -> int:
    index = start
    while index < len(text) and text[index] not in ";\n":
        index = closing(text, index) if text[index] in "([{" else index + 1
    return index


def _rest_destructuring(file: TsFile, position: int, name: str) -> tuple[set[str], str] | None:
    pattern = rf"const \{{([^}}]*)\.\.\.{name}\s*\}} = (\w+);"
    function_start = max(file.text.rfind("function ", 0, position), 0)
    found = list(re.finditer(pattern, file.text[function_start:position]))
    if not found:
        return None
    match = found[-1]
    taken = {part.strip() for part in match.group(1).split(",") if part.strip()}
    return taken, match.group(2)


def _identifier_keys(
    file: TsFile, position: int, name: str, bindings: dict[str, str]
) -> set[str] | None:
    assigned = _local_assignment(file, position, name)
    if assigned is not None:
        return payload_keys(file, position, assigned, bindings)
    destructured = _rest_destructuring(file, position, name)
    if destructured is not None:
        source = _identifier_keys(file, position, destructured[1], bindings)
        return None if source is None else source - destructured[0]
    declared = parameter_type(enclosing_function(file.text, position)[1], name)
    declared = declared or _member_parameter_type(file, position, name)
    return None if declared is None else file.types.keys(declared)


def _member_parameter_type(file: TsFile, position: int, name: str) -> str | None:
    """Type of a parameter of an object method, from the interface that declares the method."""
    members = re.findall(
        r"^\s*(?:async\s+)?(\w+)\s*(?:\(|:\s*(?:async\s*)?\()", file.text[:position], re.MULTILINE
    )
    if not members:
        return None
    for signature in re.finditer(rf"\b{members[-1]}\(([^()]*)\)\s*:", file.folder_text):
        declared = parameter_type(signature.group(1), name)
        if declared is not None:
            return declared
    return None


def _object_payload(
    file: TsFile, position: int, literal: str, bindings: dict[str, str]
) -> set[str] | None:
    keys, spreads = object_keys(literal)
    resolved = {bindings.get(key[1:-1], key) if key.startswith("[") else key for key in keys}
    for spread in spreads:
        spread_keys = payload_keys(file, position, spread, bindings)
        if spread_keys is None:
            return None
        resolved |= spread_keys
    return resolved


def payload_keys(
    file: TsFile, position: int, expression: str, bindings: dict[str, str]
) -> set[str] | None:
    """Keys of the object an expression writes, or None when they cannot be read statically."""
    text = expression.strip()
    branches = split_top(text, "?")
    if len(branches) == 2:
        options = [payload_keys(file, position, b, bindings) for b in split_top(branches[1], ":")]
        return None if any(o is None for o in options) else set().union(*(o for o in options if o))
    if text.startswith("{"):
        return _object_payload(file, position, text, bindings)
    mapped = re.search(r"=>\s*\((\{.*\})\)\s*\)$", text, re.DOTALL)
    if mapped is not None:
        return _object_payload(file, position, mapped.group(1), bindings)
    if re.fullmatch(r"\w+", text):
        return _identifier_keys(file, position, text, bindings)
    called = re.match(r"^(\w+)\(", text)
    if called is not None:
        return _returned_keys(file, called.group(1))
    return None


def _returned_keys(file: TsFile, name: str) -> set[str] | None:
    """Keys of what a function returns: a declared function or a property of function type."""
    declared = re.search(rf"function {name}\([^)]*\)\s*:\s*([\w<>\[\], |\"]+?)\s*\{{", file.text)
    typed = re.search(rf"\b{name}\??\s*:\s*\([^)]*\)\s*=>\s*([\w\[\]<>]+)", file.folder_text)
    found = declared or typed
    return None if found is None else file.types.keys(found.group(1))


def _value(file: TsFile, expression: str, bindings: dict[str, str]) -> str | None:
    return string_value(expression, {**file.constants, **bindings})


def _select_into(reference: Reference, selected: SelectList) -> Reference:
    return replace(
        reference,
        columns=reference.columns | selected.columns,
        embeds=reference.embeds + tuple(selected.embeds),
    )


def _apply_call(
    file: TsFile, reference: Reference, call: Call, bindings: dict[str, str]
) -> Reference:
    first = _value(file, call.arguments[0], bindings) if call.arguments else None
    if call.method == "select":
        return _select_into(reference, parse_select(first or "*"))
    if call.method in FILTERS and first is not None:
        return _filter_column(reference, first)
    if call.method in WRITES:
        return _apply_write(file, reference, call, bindings)
    return reference


def _filter_column(reference: Reference, column: str) -> Reference:
    """A filter on a column of the table, or on an embedded table's column (customers.id)."""
    owner, _, embedded = column.partition(".")
    if not embedded:
        return reference.with_columns({column_of(column)})
    embeds = tuple(
        replace(e, columns=e.columns | {embedded}) if e.table == owner else e
        for e in reference.embeds
    )
    known = any(e.table == owner for e in reference.embeds)
    return replace(reference, embeds=embeds) if known else reference.with_columns({owner})


def _apply_write(
    file: TsFile, reference: Reference, call: Call, bindings: dict[str, str]
) -> Reference:
    base = replace(reference, action=WRITES[call.method])
    if call.method == "delete":
        return base
    keys = payload_keys(file, call.position, call.arguments[0], bindings)
    options = call.arguments[1] if len(call.arguments) > 1 else ""
    conflict = re.search(r'onConflict:\s*"([^"]+)"', options)
    base = replace(base, conflict=tuple(conflict.group(1).split(",")) if conflict else ())
    if keys is None:
        return replace(base, unresolved=f"payload {call.arguments[0][:60]}")
    return base.with_columns(keys)


def _start(
    file: TsFile, call: Call, schema: str, role: str, bindings: dict[str, str]
) -> Reference | None:
    name = _value(file, call.arguments[0], bindings)
    if name is None:
        return None
    location = file.line(call.position)
    if call.method == "from":
        return Reference(location, role, schema, "table", name)
    arguments = call.arguments[1] if len(call.arguments) > 1 else "{}"
    keys = payload_keys(file, call.position, arguments, bindings)
    unresolved = "" if keys is not None else f"arguments {arguments[:60]}"
    return Reference(
        location, role, schema, "rpc", name, "execute", frozenset(keys or ()), unresolved=unresolved
    )


def _receiver_schema(file: TsFile, position: int, default: str) -> str | None:
    before = file.text[max(0, position - 120) : position]
    match = re.search(r"(\w+)(\(\))?(?:\s*\.\s*schema\(\s*\"(\w+)\"\s*\))?\s*$", before)
    if match is None or match.group(1) in ("storage", "Array", "Uint8Array"):
        return None
    if match.group(3):
        return match.group(3)
    if match.group(2):
        helper = re.search(rf"const {match.group(1)} = \(\) => \w+\.schema\(\"(\w+)\"\)", file.text)
        return helper.group(1) if helper else None
    return default if match.group(1) == "supabase" else None


def supabase_references(file: TsFile, default: str, role: str) -> Iterator[Reference]:
    """Every supabase-js from or rpc chain of a file."""
    for match in re.finditer(r"\.\s*(from|rpc)\(", file.text):
        schema = _receiver_schema(file, match.start(), default)
        if schema is None:
            continue
        calls = chain(file.text, match.start())
        for bindings in _bindings_for(file, match.start(), calls[0].arguments[:1]):
            reference = _start(file, calls[0], schema, role, bindings)
            if reference is None:
                yield Reference(
                    file.line(match.start()),
                    role,
                    schema,
                    "table",
                    "?",
                    unresolved=f"name {calls[0].arguments[:1]}",
                )
                continue
            for call in calls[1:]:
                reference = _apply_call(file, reference, call, bindings)
            yield reference


def _path_templates(file: TsFile, expression: str) -> list[str]:
    """Paths an argument stands for; a call of a path-building function gives its template."""
    value = string_value(expression, file.constants)
    if value is not None:
        return [value]
    called = re.match(r"^(\w+)\(", expression.strip())
    if called is None:
        return []
    found = re.search(
        rf"function {called.group(1)}\(([^)]*)\)[^{{]*\{{\s*return (`[^`]*`);", file.folder_text
    )
    if found is None:
        return []
    template = string_value(found.group(2), file.constants) or ""
    return _expand_unions(template, found.group(1))


def _expand_unions(template: str, parameters: str) -> list[str]:
    for placeholder in re.findall(r"\$\{(\w+)\}", template):
        declared = parameter_type(parameters, placeholder) or ""
        options = re.findall(r'"(\w+)"', declared)
        if options:
            return [
                p
                for o in options
                for p in _expand_unions(template.replace(f"${{{placeholder}}}", o), parameters)
            ]
    return [template]


def _path_reference(location: str, role: str, schema: str, path: str, action: str) -> Reference:
    table, selected, columns = parse_rest_path(path)
    conflict = (
        tuple(re.findall(r"on_conflict=([\w,]+)", path)[0].split(","))
        if "on_conflict=" in path
        else ()
    )
    reference = Reference(location, role, schema, "table", table, action, conflict=conflict)
    return _select_into(reference, selected).with_columns(columns - set(conflict))


def _payload(file: TsFile, position: int, reference: Reference, expression: str) -> Reference:
    keys = payload_keys(file, position, expression, {})
    if keys is None:
        return replace(reference, unresolved=f"payload {expression[:60]}")
    return reference.with_columns(keys)


def _helper_call(
    file: TsFile, helper: str, arguments: list[str], position: int, schema: str, role: str
) -> Iterator[Reference]:
    location = file.line(position)
    literal = [string_value(a, file.constants) for a in arguments]
    if helper in ("select", "selectAll", "first"):
        own_schema = literal[1] if helper != "first" and len(literal) > 1 and literal[1] else schema
        for path in _path_templates(file, arguments[0]):
            yield _path_reference(location, role, own_schema, path, "select")
    elif helper == "rpc" and literal[0] is not None:
        keys = payload_keys(file, position, arguments[1], {}) if len(arguments) > 1 else set()
        yield Reference(
            location,
            role,
            schema,
            "rpc",
            literal[0],
            "execute",
            frozenset(keys or ()),
            unresolved="" if keys is not None else "arguments",
        )
    elif helper in ("insert", "upsert", "patch") and literal[0] is not None:
        yield _write_helper(file, helper, arguments, literal, position, schema, role)


def _write_helper(
    file: TsFile,
    helper: str,
    arguments: list[str],
    literal: list[str | None],
    position: int,
    schema: str,
    role: str,
) -> Reference:
    location = file.line(position)
    table = literal[0] or "?"
    if helper == "patch":
        reference = _path_reference(location, role, schema, f"{table}?{literal[1] or ''}", "update")
        return _payload(file, position, reference, arguments[2])
    conflict_text = literal[1] if helper == "upsert" else literal[2] if len(literal) > 2 else None
    payload = arguments[1] if helper == "insert" else arguments[2]
    action = "upsert" if helper == "upsert" else "insert"
    reference = Reference(
        location,
        role,
        schema,
        "table",
        table,
        action,
        conflict=tuple(conflict_text.split(",")) if conflict_text else (),
    )
    return _payload(file, position, reference, payload)


def _rest_init_call(
    file: TsFile, arguments: list[str], position: int, schema: str, role: str
) -> Iterator[Reference]:
    init = arguments[1] if len(arguments) > 1 else ""
    method = re.search(r'method:\s*"(\w+)"', init)
    action = {"POST": "insert", "PATCH": "update", "DELETE": "delete"}.get(
        method.group(1) if method else "GET", "select"
    )
    for path in _path_templates(file, arguments[0]):
        reference = _path_reference(file.line(position), role, schema, path, action)
        body = re.search(r"body:\s*JSON\.stringify\((\{.*\})\)", init, re.DOTALL)
        yield _payload(file, position, reference, body.group(1)) if body else reference


def helper_references(file: TsFile, schema: str, role: str) -> Iterator[Reference]:
    """Every call of the REST helpers select, selectAll, first, rpc, insert, upsert, patch, rest."""
    pattern = r"(?<![\w.])(select|selectAll|first|insert|upsert|patch|rpc|rest)\s*(?=[<(])"
    for match in re.finditer(pattern, file.text):
        if file.text[max(0, match.start() - 9) : match.start()].endswith("function "):
            continue
        after = match.end()
        if file.text[after] == "<":
            after = closing(file.text, after, angle=True)
        arguments = split_top(file.text[after + 1 : closing(file.text, after) - 1])
        if not arguments:
            continue
        if match.group(1) == "rest":
            yield from _rest_init_call(file, arguments, match.start(), schema, role)
        else:
            yield from _helper_call(file, match.group(1), arguments, match.start(), schema, role)


def raw_rpc_references(file: TsFile, schema: str, role: str) -> Iterator[Reference]:
    """Fetch calls of /rest/v1/rpc/<name>; the schema comes from a Content-Profile header nearby."""
    for match in re.finditer(r"/rest/v1/rpc/(\w+)`", file.text):
        window = file.text[max(0, match.start() - 400) : match.start() + 600]
        profile = re.search(r'"Content-Profile":\s*"(\w+)"', window)
        body = re.search(r"body:\s*JSON\.stringify\((\{.*?\})\)", window, re.DOTALL)
        keys = payload_keys(file, match.start(), body.group(1), {}) if body else set()
        yield Reference(
            file.line(match.start()),
            role,
            profile.group(1) if profile else schema,
            "rpc",
            match.group(1),
            "execute",
            frozenset(keys or ()),
            unresolved="" if keys is not None else "arguments",
        )
