"""Tests for the command line.

Context: Every command is driven end to end against a throwaway workspace, so the wiring
is covered, not only the parts. | Input: tmp_path. | Output: assertions on exit codes
and written files.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from agentic_marketing.cli import main
from agentic_marketing.models import Lens
from agentic_marketing.workspace import curated_file

FIXTURE_WORKSPACE = Path(__file__).parent / "fixtures" / "workspace"


@pytest.fixture(autouse=True)
def _point_at_the_workspace(workspace: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENTIC_MARKETING_WORKSPACE", str(workspace))


def test_check_passes_on_a_fresh_workspace(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["check"]) == 0
    assert "complete" in capsys.readouterr().out


def test_check_fails_when_a_base_file_is_gone(
    workspace: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    (workspace / "stammdaten" / "unternehmen.md").unlink()
    assert main(["check"]) == 1
    assert "incomplete" in capsys.readouterr().out


def test_new_writes_a_workspace(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["new", str(tmp_path / "frisch")]) == 0
    assert (tmp_path / "frisch" / "CLAUDE.md").is_file()
    assert "Wrote" in capsys.readouterr().out


def test_new_on_an_existing_workspace_is_a_handled_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    main(["new", str(tmp_path / "frisch")])
    assert main(["new", str(tmp_path / "frisch")]) == 1
    assert "error:" in capsys.readouterr().err


def test_the_whole_pipeline(
    workspace: Path, run_folder: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["verify", str(run_folder)]) == 0
    assert (run_folder / "verifications.json").is_file()
    verdicts = {
        entry["finding_id"]: entry["verdict"]
        for entry in json.loads((run_folder / "verifications.json").read_text(encoding="utf-8"))
    }
    assert verdicts["macro-step/betriebsgroessen"] == "supported"
    assert verdicts["macro-step/erfunden"] == "unsupported"

    assert main(["review", str(run_folder)]) == 0
    assert (run_folder / "review.html").is_file()

    assert main(["apply", str(run_folder), "--auto"]) == 0
    curated = curated_file(workspace, Lens.MACRO_STEP)
    text = curated.read_text(encoding="utf-8")
    assert "kept: 1 of 2" in text
    out = capsys.readouterr().out
    assert "kept          1" in out


def test_apply_without_decisions_is_a_handled_error(
    run_folder: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    main(["verify", str(run_folder)])
    assert main(["apply", str(run_folder)]) == 1
    assert "error:" in capsys.readouterr().err


def test_review_before_verify_is_a_handled_error(
    run_folder: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["review", str(run_folder)]) == 1
    assert "run verify first" in capsys.readouterr().err


def test_pack_prints_the_measurement(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["pack"]) == 0
    out = capsys.readouterr().out
    assert "Context pack" in out
    assert "budget" in out


def test_pack_writes_a_file(tmp_path: Path) -> None:
    target = tmp_path / "pack.md"
    assert main(["pack", "--out", str(target)]) == 0
    assert "stammdaten/unternehmen.md" in target.read_text(encoding="utf-8")


def test_pack_over_budget_is_a_handled_error(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("AGENTIC_MARKETING_PACK_BUDGET", "1")
    assert main(["pack"]) == 1
    assert "budget" in capsys.readouterr().err


def test_stale_runs_offline(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["stale", "--offline"]) == 0
    assert "re-check" in capsys.readouterr().out


def test_unknown_command_is_usage_error() -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["gibtsnicht"])
    assert exit_info.value.code == 2


def test_the_bundled_example_verifies_as_documented(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The README promises six supported findings and one partial for the example run."""
    copy = tmp_path / "example"
    shutil.copytree(FIXTURE_WORKSPACE, copy)
    monkeypatch.setenv("AGENTIC_MARKETING_WORKSPACE", str(copy))
    run = copy / "strategie" / "umwelt" / "makroanalyse" / "makroanalyse-2026-08-29"
    assert main(["verify", str(run)]) == 0
    verdicts = [
        entry["verdict"]
        for entry in json.loads((run / "verifications.json").read_text(encoding="utf-8"))
    ]
    assert verdicts.count("supported") == 6
    assert verdicts.count("partial") == 1
