"""Reading a research run folder into findings.

Context: A research session leaves behind one Markdown file per finding plus the prose it
worked from. This module is the only place that knows that shape. Nothing is guessed: a
statement without a source is an error, not a finding with a blank source. | Input: a run
folder. | Output: a RunManifest.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from agentic_marketing.errors import RunError
from agentic_marketing.models import Finding, RunManifest

RUN_FILE = "run.yaml"
FINDINGS_DIR = "findings"
RAW_DIR = "raw"
FRONTMATTER_FENCE = "---"


def _split_frontmatter(text: str, path: Path) -> tuple[dict[str, Any], str]:
    """Separate the YAML header of a finding file from its body."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != FRONTMATTER_FENCE:
        raise RunError(f"{path} does not start with a YAML header")
    try:
        end = next(
            i for i, line in enumerate(lines[1:], start=1) if line.strip() == FRONTMATTER_FENCE
        )
    except StopIteration:
        raise RunError(f"{path} has an unterminated YAML header") from None
    try:
        header = yaml.safe_load("\n".join(lines[1:end])) or {}
    except yaml.YAMLError as error:
        raise RunError(f"{path} has a malformed YAML header: {error}") from error
    if not isinstance(header, dict):
        raise RunError(f"{path} has a YAML header that is not a mapping")
    return header, "\n".join(lines[end + 1 :]).strip()


def _split_body(body: str, path: Path) -> tuple[str, str]:
    """Separate the statement heading of a finding file from its detail."""
    lines = body.splitlines()
    heading = next((i for i, line in enumerate(lines) if line.startswith("# ")), None)
    if heading is None:
        raise RunError(f"{path} has no '# ' line holding the statement")
    statement = lines[heading][2:].strip()
    detail = "\n".join(lines[heading + 1 :]).strip()
    return statement, detail


def parse_finding(path: Path) -> Finding:
    """Read one finding file.

    Args:
        path: The Markdown file holding exactly one finding.

    Returns:
        The validated finding.

    Raises:
        RunError: If the file is malformed or violates the finding contract.
    """
    header, body = _split_frontmatter(path.read_text(encoding="utf-8"), path)
    statement, detail = _split_body(body, path)
    try:
        return Finding(**header, statement=statement, detail=detail)
    except ValidationError as error:
        raise RunError(f"{path}: {error}") from error
    except TypeError as error:
        raise RunError(f"{path}: unexpected keys in the header ({error})") from error


def iter_findings(folder: Path) -> Iterator[Finding]:
    """Yield findings one file at a time, without holding the run in memory.

    Args:
        folder: The run folder.

    Yields:
        Findings in file-name order.

    Raises:
        RunError: If the findings folder is missing or a file is malformed.
    """
    findings_dir = folder / FINDINGS_DIR
    if not findings_dir.is_dir():
        raise RunError(f"{folder} has no {FINDINGS_DIR}/ folder")
    for path in sorted(findings_dir.glob("*.md")):
        yield parse_finding(path)


def raw_size(folder: Path) -> int:
    """Characters of everything the run produced, for the compression figure."""
    total = 0
    for path in folder.rglob("*"):
        if path.is_file() and path.suffix in {".md", ".json", ".yaml", ".txt"}:
            total += len(path.read_text(encoding="utf-8", errors="replace"))
    return total


def read_run(folder: Path) -> RunManifest:
    """Read one run folder completely.

    Args:
        folder: The run folder, e.g. makroanalyse-2026-08-29.

    Returns:
        The manifest with every finding the run contains.

    Raises:
        RunError: If the folder is unreadable or holds no parsable finding.
    """
    if not folder.is_dir():
        raise RunError(f"{folder} is not a folder")
    run_file = folder / RUN_FILE
    if not run_file.is_file():
        raise RunError(f"{folder} has no {RUN_FILE}")
    try:
        meta = yaml.safe_load(run_file.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as error:
        raise RunError(f"{run_file} is malformed: {error}") from error
    if not isinstance(meta, dict):
        raise RunError(f"{run_file} is not a mapping")
    findings = list(iter_findings(folder))
    try:
        return RunManifest(
            run_id=meta.get("run_id", folder.name),
            lens=meta["lens"],
            subject=meta["subject"],
            produced=meta["produced"],
            findings=findings,
            raw_chars=raw_size(folder),
        )
    except KeyError as error:
        raise RunError(f"{run_file} is missing {error}") from error
    except ValidationError as error:
        raise RunError(f"{run_file}: {error}") from error
