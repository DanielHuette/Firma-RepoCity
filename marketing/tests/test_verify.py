"""Tests for verify.

Context: The first pass decides most verdicts, so each verdict has a test. | Input:
fixtures. | Output: assertions.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from agentic_marketing.config import Settings
from agentic_marketing.models import Source, SourceKind, Stage, Verdict
from agentic_marketing.verify import verify_all, verify_one
from tests.conftest import TODAY, make_finding

TEXT = "Die Erhebung lief im Fruehjahr. Von 12.480 Betrieben sind 61,4 Prozent klein."


def test_all_figures_present_is_supported() -> None:
    result = verify_one(make_finding(), TEXT, today=TODAY)
    assert result.verdict is Verdict.SUPPORTED
    assert result.stage is Stage.FIGURES
    assert not result.figures_missing
    assert result.evidence == "Von 12.480 Betrieben sind 61,4 Prozent klein."


def test_some_figures_present_is_partial() -> None:
    result = verify_one(make_finding(figures=["61,4", "99,9"]), TEXT, today=TODAY)
    assert result.verdict is Verdict.PARTIAL
    assert result.figures_missing == ["99,9"]


def test_no_figure_present_is_unsupported() -> None:
    result = verify_one(make_finding(figures=["99,9"]), TEXT, today=TODAY)
    assert result.verdict is Verdict.UNSUPPORTED
    assert result.evidence is None


def test_a_finding_without_figures_is_left_to_the_model() -> None:
    result = verify_one(make_finding(figures=[]), TEXT, today=TODAY)
    assert result.verdict is Verdict.NOT_CHECKED
    assert result.note


def test_unreadable_source_is_unreachable(tmp_path: Path) -> None:
    finding = make_finding()
    results, texts = verify_all([finding], tmp_path, Settings(workspace=None), today=TODAY)
    assert results[0].verdict is Verdict.UNREACHABLE
    assert results[0].note
    assert texts == {}


def test_each_source_is_read_once(workspace: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    import agentic_marketing.verify as module

    def spy(source: Source, root: Path, settings: Settings) -> str:
        del root, settings
        calls.append(source.address)
        return TEXT

    monkeypatch.setattr(module, "extract_text", spy)
    findings = [make_finding("a-eins"), make_finding("b-zwei")]
    results, texts = verify_all(findings, workspace, Settings(workspace=None), today=TODAY)
    assert len(calls) == 1
    assert len(results) == 2
    assert len(texts) == 1


def test_check_date_defaults_to_today() -> None:
    result = verify_one(make_finding(), TEXT)
    assert result.checked == date.today()


def test_local_source_is_read_from_the_workspace(workspace: Path) -> None:
    finding = make_finding()
    assert finding.source.kind is SourceKind.LOCAL
    results, _ = verify_all([finding], workspace, Settings(workspace=None), today=TODAY)
    assert results[0].verdict is Verdict.SUPPORTED
