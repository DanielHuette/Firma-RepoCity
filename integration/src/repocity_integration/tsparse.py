"""Just enough TypeScript reading to follow database calls: brackets, arguments, literals, types.

Context: The scanners need the arguments of supabase-js chains and REST helpers and the keys of the
objects written, without a TypeScript compiler. Strings, template literals and comments are skipped
while matching brackets. | Input: TypeScript source text. | Output: bracket matching, argument
splitting, literal values, object keys and the keys of interfaces and type expressions.
"""

import re
from dataclasses import dataclass, field

_OPEN = {"(": ")", "[": "]", "{": "}", "<": ">"}
_QUOTES = "\"'`"


def skip_string(text: str, start: int) -> int:
    """Index after the string or template literal that starts at start."""
    quote = text[start]
    index = start + 1
    while index < len(text) and text[index] != quote:
        index += 2 if text[index] == "\\" else 1
    return index + 1


def _skip_comment(text: str, index: int) -> int:
    if text.startswith("//", index):
        end = text.find("\n", index)
        return len(text) if end < 0 else end
    if text.startswith("/*", index):
        return text.index("*/", index) + 2
    return index


def closing(text: str, start: int, angle: bool = False) -> int:
    """Index after the bracket that closes the one at start; angle brackets only when asked."""
    pairs = _OPEN if angle else {k: v for k, v in _OPEN.items() if k != "<"}
    stack = [pairs[text[start]]]
    index = start + 1
    while stack:
        char = text[index]
        if char in _QUOTES:
            index = skip_string(text, index)
            continue
        skipped = _skip_comment(text, index)
        if skipped != index:
            index = skipped
            continue
        if char in pairs:
            stack.append(pairs[char])
        elif char == stack[-1]:
            stack.pop()
        index += 1
    return index


def split_top(text: str, separator: str = ",", angle: bool = False) -> list[str]:
    """Parts of text split at separators outside brackets and strings."""
    parts: list[str] = []
    index = last = 0
    while index < len(text):
        char = text[index]
        if char in _QUOTES:
            index = skip_string(text, index)
        elif char in _OPEN and (angle or char != "<"):
            index = closing(text, index, angle)
        elif text.startswith(separator, index):
            parts.append(text[last:index])
            index = last = index + len(separator)
        else:
            index += 1
    parts.append(text[last:])
    return [part.strip() for part in parts if part.strip()]


def string_value(expression: str, constants: dict[str, str]) -> str | None:
    """Value of a string literal, a template literal over constants, a constant or a + of these."""
    parts = split_top(expression.strip(), "+")
    values = [_single_string(part, constants) for part in parts]
    return None if any(value is None for value in values) else "".join(v for v in values if v)


def _single_string(expression: str, constants: dict[str, str]) -> str | None:
    if expression in constants:
        return constants[expression]
    if len(expression) >= 2 and expression[0] in _QUOTES and expression[-1] == expression[0]:
        body = expression[1:-1]
        if expression[0] == "`":
            body = re.sub(r"\$\{(\w+)\}", lambda m: constants.get(m.group(1), m.group(0)), body)
        return body
    return None


def constants_of(text: str) -> dict[str, str]:
    """String constants declared at the top level of a file, resolved in declaration order."""
    constants: dict[str, str] = {}
    for match in re.finditer(r"^(?:export )?const (\w+)(?:: string)? = ", text, re.MULTILINE):
        end = _statement_end(text, match.end())
        value = string_value(text[match.end() : end], constants)
        if value is not None:
            constants[match.group(1)] = value
    return constants


def _statement_end(text: str, start: int) -> int:
    index = start
    while index < len(text) and text[index] != ";":
        if text[index] in _QUOTES:
            index = skip_string(text, index)
        elif text[index] in "([{":
            index = closing(text, index)
        else:
            index += 1
    return index


def object_keys(literal: str) -> tuple[set[str], list[str]]:
    """Keys of an object literal and the expressions it spreads in.

    Computed keys [name] come back as "[name]" for the caller to resolve.
    """
    keys: set[str] = set()
    spreads: list[str] = []
    for entry in split_top(literal.strip()[1:-1]):
        if entry.startswith("..."):
            spreads.append(entry[3:].strip())
            continue
        match = re.match(r"^(\[\w+\]|[\w$]+|\"[^\"]+\")\s*(?::|$|\()", entry)
        if match is not None:
            keys.add(match.group(1).strip('"'))
    return keys, spreads


@dataclass
class TypeIndex:
    """Interfaces and type aliases of one program, to read the keys an object of a type has."""

    interfaces: dict[str, str] = field(default_factory=dict)
    aliases: dict[str, str] = field(default_factory=dict)

    def add_source(self, text: str) -> None:
        """Collect the interfaces and type aliases of a file."""
        pattern = r"^(?:export )?interface (\w+)(?:<[^>]*>)?(?: extends ([\w, ]+))? \{"
        for match in re.finditer(pattern, text, re.MULTILINE):
            body = text[match.end() - 1 : closing(text, match.end() - 1)]
            self.interfaces[match.group(1)] = body + (
                f" & {match.group(2)}" if match.group(2) else ""
            )
        for match in re.finditer(r"^(?:export )?type (\w+)(?:<[^>]*>)? = ", text, re.MULTILINE):
            self.aliases[match.group(1)] = text[match.end() : _statement_end(text, match.end())]

    def keys(self, type_text: str) -> set[str] | None:
        """Keys of a type expression, or None when it is not understood."""
        text = type_text.strip()
        if text.endswith("[]"):
            return self.keys(text[:-2])
        parts = split_top(text, "&", angle=True)
        if len(parts) > 1:
            found = [self.keys(part) for part in parts]
            return None if any(k is None for k in found) else set().union(*(k for k in found if k))
        return self._single(text)

    def _single(self, text: str) -> set[str] | None:
        if text.startswith("{"):
            return {key for key in object_keys(text.replace(";", ","))[0]}
        generic = re.match(r"^(Partial|Pick|Omit|Readonly)<(.*)>$", text, re.DOTALL)
        if generic is not None:
            return self._utility(generic.group(1), split_top(generic.group(2), angle=True))
        if text in self.interfaces:
            body, _, extends = self.interfaces[text].partition("} & ")
            own = self._interface_keys(body + "}")
            inherited = [self.keys(name) for name in extends.split(",") if name.strip()]
            return (
                None
                if any(k is None for k in inherited)
                else own.union(*(k for k in inherited if k))
            )
        return self.keys(self.aliases[text]) if text in self.aliases else None

    def _utility(self, name: str, arguments: list[str]) -> set[str] | None:
        base = self.keys(arguments[0])
        if base is None or name in ("Partial", "Readonly"):
            return base
        listed = set(re.findall(r'"(\w+)"', arguments[1]))
        return base & listed if name == "Pick" else base - listed

    @staticmethod
    def _interface_keys(body: str) -> set[str]:
        inner = body.strip()[1:-1]
        entries = split_top(inner.replace("\n", ";"), ";", angle=True)
        return {m.group(1) for e in entries if (m := re.match(r"^(?:readonly\s+)?(\w+)\??\s*:", e))}
