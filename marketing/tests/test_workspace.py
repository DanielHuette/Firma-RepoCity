"""Tests for workspace.

Context: The layout contract, and what scaffolding refuses to overwrite. | Input:
tmp_path. | Output: assertions.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agentic_marketing.errors import WorkspaceError
from agentic_marketing.models import Lens
from agentic_marketing.workspace import (
    check_layout,
    curated_file,
    resolve_root,
    scaffold,
    sidecar_file,
)


def test_scaffold_writes_a_complete_workspace(tmp_path: Path) -> None:
    written = scaffold(tmp_path / "neu")
    assert written
    assert check_layout(tmp_path / "neu").ok


def test_scaffold_refuses_to_overwrite(tmp_path: Path) -> None:
    scaffold(tmp_path / "neu")
    with pytest.raises(WorkspaceError, match="already holds a workspace"):
        scaffold(tmp_path / "neu")


def test_scaffold_overwrites_with_force(tmp_path: Path) -> None:
    scaffold(tmp_path / "neu")
    assert scaffold(tmp_path / "neu", force=True)


def test_check_reports_what_is_missing(workspace: Path) -> None:
    (workspace / "stammdaten" / "unternehmen.md").unlink()
    check = check_layout(workspace)
    assert not check.ok
    assert "stammdaten/unternehmen.md" in check.missing_base_files


def test_resolve_root_requires_a_configured_workspace() -> None:
    with pytest.raises(WorkspaceError):
        resolve_root(None)


def test_resolve_root_rejects_a_missing_path(tmp_path: Path) -> None:
    with pytest.raises(WorkspaceError, match="does not exist"):
        resolve_root(tmp_path / "gibtsnicht")


def test_curated_path_and_sidecar(workspace: Path) -> None:
    target = curated_file(workspace, Lens.MACRO_STEP)
    assert target.name == "makro-analyse.md"
    assert sidecar_file(target).name == "makro-analyse.sources.json"
