"""An in-memory stand-in for the cockpit database.

Context: The campaign, publishing, metrics and report code talks to the cockpit only through
the few methods of CockpitClient. This fake keeps rows in dictionaries and understands the
filter forms the code uses (`eq.`, `in.()`, `lte.`), so those modules can be tested without a
network. | Input: rows. | Output: rows.
"""

from __future__ import annotations

import itertools
from collections.abc import Mapping, Sequence
from typing import Any

Row = dict[str, Any]
_ids = itertools.count(1)


def _matches(row: Row, filters: Mapping[str, str]) -> bool:
    for key, rule in filters.items():
        if key in {"select", "order", "limit"}:
            continue
        value = row.get(key)
        text = "true" if value is True else "false" if value is False else str(value)
        if rule.startswith("eq.") and text != rule[3:]:
            return False
        if rule.startswith("in.(") and text not in rule[4:-1].split(","):
            return False
        if rule.startswith("lte.") and not text <= rule[4:]:
            return False
        if rule.startswith("gt.") and not text > rule[3:]:
            return False
    return True


class FakeCockpit:
    """Rows in memory, the same calls as CockpitClient."""

    def __init__(self) -> None:
        self.tables: dict[str, list[Row]] = {}
        self.events: list[Row] = []

    def rows(self, table: str) -> list[Row]:
        return self.tables.setdefault(table, [])

    def add(self, table: str, **values: Any) -> Row:
        row = {"id": str(next(_ids)), **values}
        self.rows(table).append(row)
        return row

    def select(self, table: str, params: Mapping[str, str]) -> list[Row]:
        return [dict(row) for row in self.rows(table) if _matches(row, params)]

    def upsert(
        self, table: str, rows: Sequence[Mapping[str, Any]], *, on_conflict: str
    ) -> list[Row]:
        keys = on_conflict.split(",")
        stored: list[Row] = []
        for incoming in rows:
            existing = next(
                (
                    row
                    for row in self.rows(table)
                    if all(row.get(k) == incoming.get(k) for k in keys)
                ),
                None,
            )
            if existing is None:
                existing = self.add(table, **incoming)
            else:
                existing.update(incoming)
            stored.append(dict(existing))
        return stored

    def insert(self, table: str, rows: Sequence[Mapping[str, Any]]) -> list[Row]:
        return [dict(self.add(table, **row)) for row in rows]

    def update(
        self, table: str, filters: Mapping[str, str], values: Mapping[str, Any]
    ) -> list[Row]:
        changed = []
        for row in self.rows(table):
            if _matches(row, filters):
                row.update(values)
                changed.append(dict(row))
        return changed

    def delete(self, table: str, filters: Mapping[str, str]) -> None:
        self.tables[table] = [row for row in self.rows(table) if not _matches(row, filters)]

    def log_event(
        self, campaign_id: str, kind: str, *, post_id: str | None = None, note: str | None = None
    ) -> None:
        self.events.append(
            {"campaign_id": campaign_id, "kind": kind, "post_id": post_id, "note": note}
        )


class FakeWriter:
    """Records commits instead of pushing them."""

    def __init__(self) -> None:
        self.commits: list[tuple[str, str, dict[str, str], str]] = []

    def commit(self, repo: str, branch: str, files: Mapping[str, str], message: str) -> str:
        self.commits.append((repo, branch, dict(files), message))
        return f"https://github.com/{repo}/commit/{len(self.commits)}"
