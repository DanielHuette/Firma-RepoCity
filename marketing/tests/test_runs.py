"""Tests for runs.

Context: Reading a run has to fail loudly on every shape it does not understand. |
Input: run folders in tmp_path. | Output: assertions.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agentic_marketing.errors import RunError
from agentic_marketing.runs import parse_finding, raw_size, read_run


def test_read_run_collects_every_finding(run_folder: Path) -> None:
    manifest = read_run(run_folder)
    assert manifest.run_id == "makroanalyse-2026-08-29"
    assert [finding.slug for finding in manifest.findings] == ["betriebsgroessen", "erfunden"]
    assert manifest.raw_chars > 0


def test_missing_folder_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(RunError, match="is not a folder"):
        read_run(tmp_path / "nix")


def test_missing_run_file_is_an_error(tmp_path: Path) -> None:
    (tmp_path / "lauf").mkdir()
    with pytest.raises(RunError, match=r"has no run\.yaml"):
        read_run(tmp_path / "lauf")


def test_missing_findings_folder_is_an_error(tmp_path: Path) -> None:
    folder = tmp_path / "lauf"
    folder.mkdir()
    (folder / "run.yaml").write_text(
        "lens: macro-step\nsubject: X\nproduced: 2026-01-01\n", encoding="utf-8"
    )
    with pytest.raises(RunError, match="findings/ folder"):
        read_run(folder)


def test_a_file_without_a_header_is_an_error(tmp_path: Path) -> None:
    path = tmp_path / "f.md"
    path.write_text("# Ein Satz der lang genug ist\n\nText.\n", encoding="utf-8")
    with pytest.raises(RunError, match="does not start with a YAML header"):
        parse_finding(path)


def test_an_unterminated_header_is_an_error(tmp_path: Path) -> None:
    path = tmp_path / "f.md"
    path.write_text("---\nid: macro-step/x\n", encoding="utf-8")
    with pytest.raises(RunError, match="unterminated"):
        parse_finding(path)


def test_a_file_without_a_statement_is_an_error(tmp_path: Path) -> None:
    path = tmp_path / "f.md"
    path.write_text("---\nid: macro-step/abc\n---\n\nNur Fliesstext.\n", encoding="utf-8")
    with pytest.raises(RunError, match="no '# ' line"):
        parse_finding(path)


def test_a_finding_that_breaks_the_contract_is_an_error(tmp_path: Path) -> None:
    path = tmp_path / "f.md"
    path.write_text(
        "---\nid: macro-step/abc\nlens: macro-step\nfield: sociocultural\n"
        "horizon: current\nvolatility: structural\nfigures: []\n"
        "source:\n  kind: internal\n  publisher: X\n  title: Export\n"
        "  published: 2026-01-01\n  retrieved: 2026-01-02\n---\n\n# Zu kurz\n\nText.\n",
        encoding="utf-8",
    )
    with pytest.raises(RunError):
        parse_finding(path)


def test_raw_size_counts_only_text(run_folder: Path) -> None:
    (run_folder / "raw" / "bild.png").write_bytes(b"\x89PNG" + b"0" * 5000)
    assert raw_size(run_folder) < 5000
