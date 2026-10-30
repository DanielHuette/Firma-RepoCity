"""Tests for pack.

Context: The pack is the promise that a session starts small; a pack that silently grows
past its budget breaks it. | Input: a workspace. | Output: assertions.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agentic_marketing.errors import BudgetExceededError, WorkspaceError
from agentic_marketing.pack import build_pack
from agentic_marketing.workspace import BASE_FILES


def test_pack_holds_every_base_file(workspace: Path) -> None:
    text, pack = build_pack(workspace, budget=100_000)
    assert [packed.path for packed in pack.files] == list(BASE_FILES)
    for name in BASE_FILES:
        assert name in text


def test_extra_files_are_appended(workspace: Path) -> None:
    extra = "produkte/zusatz.md"
    (workspace / extra).write_text("Zusatz\n", encoding="utf-8")
    _, pack = build_pack(workspace, budget=100_000, extra=[extra])
    assert pack.files[-1].path == extra


def test_a_missing_base_file_is_an_error(workspace: Path) -> None:
    (workspace / BASE_FILES[0]).unlink()
    with pytest.raises(WorkspaceError, match="missing"):
        build_pack(workspace, budget=100_000)


def test_a_missing_extra_file_is_an_error(workspace: Path) -> None:
    with pytest.raises(WorkspaceError, match="missing"):
        build_pack(workspace, budget=100_000, extra=["gibtsnicht.md"])


def test_a_pack_over_budget_is_an_error(workspace: Path) -> None:
    with pytest.raises(BudgetExceededError, match="shorten a curated file"):
        build_pack(workspace, budget=1)


def test_totals_add_up(workspace: Path) -> None:
    _, pack = build_pack(workspace, budget=100_000)
    assert pack.chars == sum(f.chars for f in pack.files)
    assert pack.tokens == sum(f.tokens for f in pack.files)
