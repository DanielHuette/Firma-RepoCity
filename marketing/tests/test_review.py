"""Tests for review.

Context: The page is only the surface; the decisions file is the contract, so its
reading is pinned hardest. | Input: fixtures and tmp_path. | Output: assertions.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agentic_marketing.errors import DecisionError
from agentic_marketing.models import Verdict
from agentic_marketing.review import (
    DECISIONS_NAME,
    build_page,
    keep_supported,
    pending,
    read_decisions,
    write_decisions,
    write_page,
)
from tests.conftest import TODAY, make_finding, make_verification


def test_page_is_self_contained_and_shows_every_finding() -> None:
    findings = [make_finding("eins"), make_finding("zwei")]
    checks = [make_verification(f.id) for f in findings]
    page = build_page(findings, checks, run_id="r1", decisions_path=Path("d.json"))
    assert "http://" not in page and "https://" not in page
    assert page.count('class="card"') == 2
    assert "r1" in page


def test_page_escapes_markup_in_a_finding() -> None:
    finding = make_finding().model_copy(update={"detail": "Ein <script>alert(1)</script> Text."})
    page = build_page([finding], [], run_id="r", decisions_path=Path("d.json"))
    assert "<script>alert(1)</script>" not in page
    assert "&lt;script&gt;" in page


def test_page_names_the_missing_figures() -> None:
    finding = make_finding()
    check = make_verification(finding.id, Verdict.PARTIAL).model_copy(
        update={"figures_missing": ["99,9"]}
    )
    page = build_page([finding], [check], run_id="r", decisions_path=Path("d.json"))
    assert "99,9" in page


def test_write_page_creates_the_file(tmp_path: Path) -> None:
    target = write_page("<html></html>", tmp_path / "a" / "review.html")
    assert target.read_text(encoding="utf-8") == "<html></html>"


def test_decisions_round_trip(tmp_path: Path) -> None:
    findings = [make_finding("eins"), make_finding("zwei")]
    checks = [make_verification(f.id) for f in findings]
    decisions = keep_supported(findings, checks, today=TODAY)
    path = write_decisions(decisions, tmp_path / DECISIONS_NAME, run_id="r1")
    assert [d.finding_id for d in read_decisions(path, run_id="r1")] == [f.id for f in findings]


def test_decisions_of_another_run_are_refused(tmp_path: Path) -> None:
    path = tmp_path / DECISIONS_NAME
    path.write_text(json.dumps({"run_id": "andere", "decisions": []}), encoding="utf-8")
    with pytest.raises(DecisionError, match="belongs to run"):
        read_decisions(path, run_id="r1")


def test_missing_decisions_file_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(DecisionError, match="does not exist"):
        read_decisions(tmp_path / "weg.json", run_id="r1")


def test_malformed_decisions_file_is_an_error(tmp_path: Path) -> None:
    path = tmp_path / DECISIONS_NAME
    path.write_text("kein json", encoding="utf-8")
    with pytest.raises(DecisionError, match="cannot be read"):
        read_decisions(path, run_id="r1")


def test_decisions_without_a_list_are_an_error(tmp_path: Path) -> None:
    path = tmp_path / DECISIONS_NAME
    path.write_text(json.dumps({"run_id": "r1"}), encoding="utf-8")
    with pytest.raises(DecisionError, match="no decisions list"):
        read_decisions(path, run_id="r1")


def test_auto_decisions_drop_what_did_not_hold_up() -> None:
    findings = [make_finding("eins"), make_finding("zwei")]
    checks = [
        make_verification(findings[0].id, Verdict.SUPPORTED),
        make_verification(findings[1].id, Verdict.UNSUPPORTED),
    ]
    decisions = keep_supported(findings, checks, today=TODAY)
    assert [d.keep for d in decisions] == [True, False]


def test_pending_lists_what_nobody_ruled_on() -> None:
    findings = [make_finding("eins"), make_finding("zwei")]
    decisions = keep_supported(findings[:1], [make_verification(findings[0].id)], today=TODAY)
    assert pending(findings, decisions) == [findings[1].id]
