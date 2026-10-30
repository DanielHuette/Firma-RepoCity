"""Tests for compact.

Context: What reaches the workspace, and what the numbers say about it. | Input:
fixtures. | Output: assertions.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from agentic_marketing.compact import CONTRACT_LINE, compact, kept_findings, sidecar, write_curated
from agentic_marketing.errors import DecisionError
from agentic_marketing.models import Decision, Lens, RunManifest, Verdict
from agentic_marketing.workspace import report_file, sidecar_file
from tests.conftest import TODAY, make_finding, make_verification


def _manifest(*slugs: str) -> RunManifest:
    return RunManifest(
        run_id="lauf-2026-08-29",
        lens=Lens.MACRO_STEP,
        subject="Beispiel GmbH",
        produced=TODAY,
        findings=[make_finding(slug) for slug in slugs],
        raw_chars=10_000,
    )


def _decision(finding_id: str, keep: bool) -> Decision:
    return Decision(finding_id=finding_id, keep=keep, note=None, decided=TODAY)


def test_only_kept_findings_reach_the_file() -> None:
    manifest = _manifest("alpha", "omega")
    checks = [make_verification(f.id) for f in manifest.findings]
    decisions = [
        _decision(manifest.findings[0].id, True),
        _decision(manifest.findings[1].id, False),
    ]
    content, report = compact(manifest, checks, decisions)
    assert report.kept == 1
    assert report.findings_in == 2
    assert CONTRACT_LINE in content
    assert manifest.findings[0].statement in content
    assert "omega" not in content


def test_sources_are_listed_in_the_header() -> None:
    manifest = _manifest("eins")
    content, _ = compact(
        manifest,
        [make_verification(manifest.findings[0].id)],
        [_decision(manifest.findings[0].id, True)],
    )
    assert "sources:" in content
    assert "daten/quellen/beleg.txt" in content


def test_a_decision_for_an_unknown_finding_is_an_error() -> None:
    manifest = _manifest("eins")
    with pytest.raises(DecisionError, match="does not contain"):
        compact(manifest, [], [_decision("macro-step/gibtsnicht", True)])


def test_an_empty_result_says_so() -> None:
    manifest = _manifest("eins")
    content, report = compact(manifest, [], [_decision(manifest.findings[0].id, False)])
    assert report.kept == 0
    assert "Nothing from this run was kept" in content


def test_counts_come_from_the_verdicts() -> None:
    manifest = _manifest("eins", "zwei")
    checks = [
        make_verification(manifest.findings[0].id, Verdict.SUPPORTED),
        make_verification(manifest.findings[1].id, Verdict.UNREACHABLE),
    ]
    _, report = compact(manifest, checks, [_decision(f.id, True) for f in manifest.findings])
    assert (report.supported, report.unreachable) == (1, 1)
    assert 0 < report.shrink_ratio < 1


def test_write_curated_writes_three_files(tmp_path: Path) -> None:
    manifest = _manifest("eins")
    decisions = [_decision(manifest.findings[0].id, True)]
    content, report = compact(manifest, [make_verification(manifest.findings[0].id)], decisions)
    target = write_curated(content, tmp_path / "makro-analyse.md", report, manifest.findings)
    assert target.is_file()
    assert sidecar_file(target).is_file()
    stored = json.loads(report_file(target).read_text(encoding="utf-8"))
    assert stored["run_id"] == "lauf-2026-08-29"


def test_sidecar_carries_what_the_freshness_scan_needs() -> None:
    entries = json.loads(sidecar([make_finding()]))["entries"]
    assert entries[0]["volatility"] == "structural"
    assert date.fromisoformat(entries[0]["published"])


def test_kept_findings_keep_the_original_order() -> None:
    manifest = _manifest("alpha", "beta", "gamma")
    decisions = [_decision(f.id, True) for f in reversed(manifest.findings)]
    assert [f.slug for f in kept_findings(manifest.findings, decisions)] == [
        "alpha",
        "beta",
        "gamma",
    ]
