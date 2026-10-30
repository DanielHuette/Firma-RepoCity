"""What a caller asks of the database, independent of the language it is written in.

Context: The apps, the Edge Functions and the RadarAuditor worker reach the shared database through
PostgREST (supabase-js, supabase-py or plain REST paths). The scanners turn their source into
Reference values, the catalog check compares those with the built database. | Input: PostgREST
select lists and REST paths. | Output: Reference, Embed, parse_select and parse_rest_path.
"""

import re
from dataclasses import dataclass, field, replace
from urllib.parse import parse_qsl

ROLES = ("anon", "authenticated", "service_role")


@dataclass(frozen=True)
class Embed:
    """A related table pulled into a select list, such as customer:customers(id, name)."""

    table: str
    columns: frozenset[str]
    embeds: tuple["Embed", ...] = ()


@dataclass(frozen=True)
class Reference:
    """One database call of one caller.

    Attributes:
        location: Source file and line, relative to the repository.
        role: Database role the caller runs as (anon, authenticated, service_role).
        schema: Schema PostgREST resolves the name in.
        kind: "rpc" for a function, "table" for a table or view.
        name: Function or table name.
        action: select, insert, update, upsert or delete for tables; execute for functions.
        arguments: Named arguments of a function call.
        columns: Columns read, filtered, ordered or written.
        embeds: Related tables of the select list.
        conflict: Columns of on_conflict for an insert or upsert.
        unresolved: Why part of the call could not be read statically, or empty.
    """

    location: str
    role: str
    schema: str
    kind: str
    name: str
    action: str = "select"
    arguments: frozenset[str] = frozenset()
    columns: frozenset[str] = frozenset()
    embeds: tuple[Embed, ...] = ()
    conflict: tuple[str, ...] = ()
    unresolved: str = ""

    def with_columns(self, names: set[str] | frozenset[str]) -> "Reference":
        """The same reference with more columns."""
        return replace(self, columns=self.columns | frozenset(names))


@dataclass
class SelectList:
    """Columns and embeds of a PostgREST select list."""

    columns: set[str] = field(default_factory=set)
    embeds: list[Embed] = field(default_factory=list)


def _split_top_level(text: str) -> list[str]:
    parts: list[str] = []
    depth = 0
    current = ""
    for char in text:
        depth += {"(": 1, ")": -1}.get(char, 0)
        if char == "," and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += char
    parts.append(current)
    return [part.strip() for part in parts if part.strip()]


_EMBED = re.compile(r"^(?:\w+:)?(\w+)(?:!\w+)?\((.*)\)$", re.DOTALL)
_COLUMN = re.compile(r"^(?:\w+:)?([\w]+)(?:->>?[\w']+)*(?:::\w+)?$")


def parse_select(text: str) -> SelectList:
    """Columns and embeds of a select list; "*" and count are no columns.

    Raises:
        ValueError: If an item is neither a column nor an embed.
    """
    result = SelectList()
    for item in _split_top_level(text):
        embed = _EMBED.match(item)
        if embed is not None:
            inner = parse_select(embed.group(2))
            result.embeds.append(
                Embed(embed.group(1), frozenset(inner.columns), tuple(inner.embeds))
            )
            continue
        if item in ("*", "count"):
            continue
        column = _COLUMN.match(item)
        if column is None:
            raise ValueError(f"select item not understood: {item}")
        result.columns.add(column.group(1))
    return result


_NOT_COLUMNS = {"select", "order", "limit", "offset", "on_conflict", "or", "and"}


def column_of(expression: str) -> str:
    """The column of a filter or order expression: data->>error is data, name.desc is name."""
    return re.split(r"->|\.|::", expression.strip(), maxsplit=1)[0]


def parse_rest_path(path: str) -> tuple[str, SelectList, set[str]]:
    """Table, select list and other columns of a PostgREST path such as table?a=eq.1&select=b.

    Template placeholders like ${id} may stand in values; they are never in column names.
    """
    table, _, query = path.partition("?")
    selected = SelectList()
    columns: set[str] = set()
    for key, value in parse_qsl(query, keep_blank_values=True):
        if key == "select":
            selected = parse_select(value)
        elif key == "order":
            columns |= {column_of(part) for part in value.split(",")}
        elif key == "on_conflict":
            columns |= set(value.split(","))
        elif key not in _NOT_COLUMNS:
            columns.add(column_of(key))
    return table, selected, columns
