"""Tests for report.

Context: The numbers are the product, so the lines that carry them are pinned. | Input:
report objects. | Output: assertions.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

from agentic_marketing.freshness import StaleEntry
from agentic_marketing.models import CompactionReport, ContextPack, PackedFile, Volatility
from agentic_marketing.report import format_check, format_compaction, format_pack, format_stale
from agentic_marketing.workspace import WorkspaceCheck


def test_compaction_states_the_share_that_is_left() -> None:
    report = CompactionReport(
        run_id="lauf-2026-08-29",
        findings_in=7,
        supported=6,
        partial=1,
        unsupported=0,
        unreachable=0,
        kept=6,
        raw_chars=10_000,
        curated_chars=3_000,
    )
    text = format_compaction(report)
    assert "30.0 %" in text
    assert "dropped 1" in text


def test_pack_block_shows_the_budget_left() -> None:
    pack = ContextPack(files=[PackedFile(path="a.md", chars=400, tokens=100)], budget=1_000)
    text = format_pack(pack)
    assert "900 left" in text
    assert "a.md" in text


def test_stale_block_is_sorted_oldest_first() -> None:
    entries = [
        StaleEntry(Path("a.md"), "x/jung", "alt", 100, Volatility.PRICE),
        StaleEntry(Path("a.md"), "x/alt", "alt", 900, Volatility.MARKET),
    ]
    lines = format_stale(entries).splitlines()
    assert "x/alt" in lines[1]


def test_empty_stale_block_says_so() -> None:
    assert "Nothing is due" in format_stale([])


def test_check_block_names_what_is_missing() -> None:
    check = WorkspaceCheck(Path("/ws"), ("inbox",), ("stammdaten/unternehmen.md",))
    text = format_check(check)
    assert "missing folder  inbox" in text
    assert "stammdaten/unternehmen.md" in text
    assert "is complete" in format_check(WorkspaceCheck(Path("/ws"), (), ()))
    assert date.today()
