"""Tests for models.

Context: The model is the contract; these tests pin what it refuses. | Input: fixtures. |
Output: assertions.
"""

from __future__ import annotations

from datetime import date

import pytest
from pydantic import ValidationError

from agentic_marketing.models import (
    CompactionReport,
    ContextPack,
    Finding,
    Horizon,
    Lens,
    PackedFile,
    Source,
    SourceKind,
    StepField,
    Volatility,
    needs_recheck,
)
from tests.conftest import make_finding


def test_short_statement_is_rejected() -> None:
    with pytest.raises(ValidationError, match="heading, not a finding"):
        Finding(
            id="macro-step/kurz",
            lens=Lens.MACRO_STEP,
            field=StepField.ECONOMIC,
            horizon=Horizon.CURRENT,
            volatility=Volatility.PRICE,
            statement="Markt waechst stark aktuell",
            detail="x" * 50,
            source=Source(
                kind=SourceKind.INTERNAL,
                publisher="Intern",
                title="Export",
                published=date(2026, 1, 1),
                retrieved=date(2026, 1, 2),
            ),
        )


def test_macro_finding_needs_a_step_field() -> None:
    with pytest.raises(ValidationError, match="needs a STEP field"):
        make_finding(field=None)


def test_id_must_match_the_lens() -> None:
    with pytest.raises(ValidationError, match="does not match lens"):
        Finding(
            id="micro/abc",
            lens=Lens.MACRO_STEP,
            field=StepField.ECONOMIC,
            horizon=Horizon.CURRENT,
            volatility=Volatility.PRICE,
            statement="Dieser Satz ist lang genug fuer den Test",
            detail="y" * 50,
            source=make_finding().source,
        )


def test_web_source_without_url_is_rejected() -> None:
    with pytest.raises(ValidationError, match="needs a url"):
        Source(
            kind=SourceKind.WEB,
            publisher="Amt",
            title="Bericht",
            published=date(2026, 1, 1),
            retrieved=date(2026, 1, 2),
        )


def test_relative_url_is_rejected() -> None:
    with pytest.raises(ValidationError, match="must be absolute"):
        Source(
            kind=SourceKind.WEB,
            publisher="Amt",
            title="Bericht",
            url="/bericht.pdf",
            published=date(2026, 1, 1),
            retrieved=date(2026, 1, 2),
        )


def test_retrieved_before_published_is_rejected() -> None:
    with pytest.raises(ValidationError, match="retrieved is before published"):
        Source(
            kind=SourceKind.INTERNAL,
            publisher="Intern",
            title="Export",
            published=date(2026, 5, 1),
            retrieved=date(2026, 4, 1),
        )


def test_citation_carries_locator_and_address(local_source: Source) -> None:
    citation = local_source.citation()
    assert "Seite 7" in citation
    assert "daten/quellen/beleg.txt" in citation


def test_markdown_collapses_the_detail() -> None:
    finding = make_finding()
    rendered = finding.to_markdown()
    assert len(rendered.splitlines()) == 2
    assert rendered.splitlines()[1].lstrip().startswith("Source:")


@pytest.mark.parametrize(
    ("volatility", "age", "expected"),
    [
        (Volatility.PRICE, 89, False),
        (Volatility.PRICE, 91, True),
        (Volatility.MARKET, 364, False),
        (Volatility.MARKET, 366, True),
        (Volatility.STRUCTURAL, 10_000, False),
    ],
)
def test_recheck_windows(volatility: Volatility, age: int, expected: bool) -> None:
    assert needs_recheck(volatility, age) is expected


def test_shrink_ratio_handles_an_empty_run() -> None:
    report = CompactionReport(
        run_id="r",
        findings_in=0,
        supported=0,
        partial=0,
        unsupported=0,
        unreachable=0,
        kept=0,
        raw_chars=0,
        curated_chars=0,
    )
    assert report.shrink_ratio == 0.0


def test_pack_budget() -> None:
    pack = ContextPack(files=[PackedFile(path="a.md", chars=40, tokens=10)], budget=10)
    assert pack.within_budget
    assert ContextPack(files=pack.files, budget=9).within_budget is False
