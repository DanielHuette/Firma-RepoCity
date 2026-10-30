"""Layout of a marketing workspace and the paths inside it.

Context: Every other module asks this one where something belongs, so the folder
convention exists in one place. A workspace is a plain folder tree of Markdown files; the
layout is fixed, the content is the user's. | Input: a workspace root. | Output: resolved
paths and a verdict on whether the tree is intact.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from importlib import resources
from pathlib import Path

from agentic_marketing.errors import WorkspaceError
from agentic_marketing.models import Lens

BASE_FILES: tuple[str, ...] = (
    "stammdaten/personal-data.md",
    "stammdaten/unternehmen.md",
    "strategie/positionierung/positionierung.md",
    "strategie/positionierung/zielgruppe.md",
    "strategie/ziele/marketingziele.md",
    "strategie/umwelt/makroanalyse/makro-analyse.md",
)

REQUIRED_FOLDERS: tuple[str, ...] = (
    ".claude/commands",
    ".claude/skills",
    "stammdaten",
    "strategie/positionierung",
    "strategie/ziele",
    "strategie/umwelt/makroanalyse",
    "strategie/umwelt/mikroanalyse",
    "strategie/umwelt/unternehmensanalyse",
    "produkte",
    "kanaele",
    "kampagnen",
    "projekte",
    "daten",
    "inbox",
    "tools",
)

LENS_HOME: dict[Lens, str] = {
    Lens.MACRO_STEP: "strategie/umwelt/makroanalyse",
    Lens.MICRO: "strategie/umwelt/mikroanalyse",
    Lens.COMPETITOR: "strategie/umwelt/unternehmensanalyse",
    Lens.PORTERS_FIVE: "strategie/umwelt/unternehmensanalyse",
    Lens.REVIEWS: "strategie/umwelt/mikroanalyse",
    Lens.AUDIENCE: "strategie/positionierung",
}

CURATED_NAME: dict[Lens, str] = {
    Lens.MACRO_STEP: "makro-analyse.md",
    Lens.MICRO: "mikro-analyse.md",
    Lens.COMPETITOR: "wettbewerb.md",
    Lens.PORTERS_FIVE: "porters-five.md",
    Lens.REVIEWS: "reviews.md",
    Lens.AUDIENCE: "zielgruppe.md",
}


@dataclass(frozen=True, slots=True)
class WorkspaceCheck:
    """What a layout check found."""

    root: Path
    missing_folders: tuple[str, ...]
    missing_base_files: tuple[str, ...]

    @property
    def ok(self) -> bool:
        """True when nothing is missing."""
        return not self.missing_folders and not self.missing_base_files


def template_root() -> Path:
    """Folder of the bundled workspace template."""
    return Path(str(resources.files("agentic_marketing") / "template"))


def resolve_root(configured: Path | None) -> Path:
    """Decide which workspace the commands operate on.

    Args:
        configured: The path from the settings, or None.

    Returns:
        The configured workspace.

    Raises:
        WorkspaceError: If no workspace is configured or the path does not exist.
    """
    if configured is None:
        raise WorkspaceError("no workspace configured; set AGENTIC_MARKETING_WORKSPACE")
    root = configured.expanduser()
    if not root.is_dir():
        raise WorkspaceError(f"workspace {root} does not exist")
    return root


def check_layout(root: Path) -> WorkspaceCheck:
    """Report which folders and base files the workspace is missing.

    Args:
        root: Workspace root.

    Returns:
        The finding, with empty tuples when the tree is intact.
    """
    missing_folders = tuple(name for name in REQUIRED_FOLDERS if not (root / name).is_dir())
    missing_files = tuple(name for name in BASE_FILES if not (root / name).is_file())
    return WorkspaceCheck(
        root=root, missing_folders=missing_folders, missing_base_files=missing_files
    )


def scaffold(target: Path, *, force: bool = False) -> list[Path]:
    """Write a fresh workspace from the bundled template.

    Args:
        target: Folder to create the workspace in.
        force: Overwrite files that already exist.

    Returns:
        The paths written, in creation order.

    Raises:
        WorkspaceError: If the target already holds a workspace and force is false.
    """
    source = template_root()
    if not source.is_dir():
        raise WorkspaceError(f"the bundled template is missing at {source}")
    if (target / "CLAUDE.md").exists() and not force:
        raise WorkspaceError(f"{target} already holds a workspace; pass --force to overwrite")
    written: list[Path] = []
    for item in sorted(source.rglob("*")):
        relative = item.relative_to(source)
        destination = target / relative
        if item.is_dir():
            destination.mkdir(parents=True, exist_ok=True)
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(item, destination)
        written.append(destination)
    return written


def lens_home(root: Path, lens: Lens) -> Path:
    """Folder a lens keeps its runs and its curated file in."""
    return root / LENS_HOME[lens]


def curated_file(root: Path, lens: Lens) -> Path:
    """Path of the curated context file a lens writes to."""
    return lens_home(root, lens) / CURATED_NAME[lens]


def sidecar_file(curated: Path) -> Path:
    """Path of the structured companion next to a curated file."""
    return curated.with_suffix(".sources.json")


def report_file(curated: Path) -> Path:
    """Path of the compaction report next to a curated file."""
    return curated.with_suffix(".report.json")
