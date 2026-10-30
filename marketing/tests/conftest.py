"""Shared fixtures.

Context: Builds a throwaway workspace and a small research run in tmp_path, so no test
touches a real workspace and none of them reach the network. | Input: pytest tmp_path. |
Output: fixtures.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from agentic_marketing.models import (
    Finding,
    Horizon,
    Lens,
    Source,
    SourceKind,
    Stage,
    StepField,
    Verdict,
    Verification,
    Volatility,
)
from agentic_marketing.workspace import scaffold

TODAY = date(2026, 8, 29)
SOURCE_TEXT = "Von 12.480 Betrieben sind 61,4 Prozent klein. Das Mittel liegt bei 54,6 Jahren.\n"


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    """A fresh workspace written from the bundled template."""
    root = tmp_path / "ws"
    root.mkdir()
    scaffold(root)
    (root / "daten" / "quellen").mkdir(parents=True, exist_ok=True)
    (root / "daten" / "quellen" / "beleg.txt").write_text(SOURCE_TEXT, encoding="utf-8")
    return root


@pytest.fixture
def local_source() -> Source:
    """A source that lives in the workspace and can be read without a network."""
    return Source(
        kind=SourceKind.LOCAL,
        publisher="Beispielverband",
        title="Strukturbericht 2026",
        path="daten/quellen/beleg.txt",
        published=date(2026, 3, 11),
        retrieved=TODAY,
        locator="Seite 7",
    )


def make_finding(
    slug: str = "betriebsgroessen",
    *,
    figures: list[str] | None = None,
    source: Source | None = None,
    field: StepField | None = StepField.SOCIOCULTURAL,
    volatility: Volatility = Volatility.STRUCTURAL,
) -> Finding:
    """Build a valid finding, varied through the keyword arguments."""
    return Finding(
        id=f"macro-step/{slug}",
        lens=Lens.MACRO_STEP,
        field=field,
        horizon=Horizon.CURRENT,
        volatility=volatility,
        statement="Fast zwei Drittel der Betriebe haben weniger als zwanzig Beschaeftigte",
        detail="Von 12.480 erfassten Betrieben sind 61,4 Prozent klein. Das sagt, wer entscheidet.",
        figures=["12.480", "61,4"] if figures is None else figures,
        source=source
        or Source(
            kind=SourceKind.LOCAL,
            publisher="Beispielverband",
            title="Strukturbericht 2026",
            path="daten/quellen/beleg.txt",
            published=date(2026, 3, 11),
            retrieved=TODAY,
        ),
    )


def make_verification(finding_id: str, verdict: Verdict = Verdict.SUPPORTED) -> Verification:
    """Build a verification for a finding."""
    return Verification(finding_id=finding_id, stage=Stage.FIGURES, verdict=verdict, checked=TODAY)


@pytest.fixture
def run_folder(workspace: Path) -> Path:
    """A run folder with two findings, one of them citing a figure the source lacks."""
    folder = workspace / "strategie/umwelt/makroanalyse/makroanalyse-2026-08-29"
    (folder / "findings").mkdir(parents=True)
    (folder / "raw").mkdir()
    (folder / "run.yaml").write_text(
        "run_id: makroanalyse-2026-08-29\nlens: macro-step\n"
        "subject: Beispiel GmbH\nproduced: 2026-08-29\n",
        encoding="utf-8",
    )
    (folder / "raw" / "notizen.md").write_text("Rohnotizen.\n" * 40, encoding="utf-8")
    _write_finding(folder, "001-betriebsgroessen.md", "betriebsgroessen", ["12.480", "61,4"])
    _write_finding(folder, "002-erfunden.md", "erfunden", ["99,9"])
    return folder


def _write_finding(folder: Path, name: str, slug: str, figures: list[str]) -> None:
    """Write one finding file into a run folder."""
    listed = ", ".join(f'"{figure}"' for figure in figures)
    (folder / "findings" / name).write_text(
        "---\n"
        f"id: macro-step/{slug}\n"
        "lens: macro-step\n"
        "field: sociocultural\n"
        "horizon: current\n"
        "volatility: structural\n"
        f"figures: [{listed}]\n"
        "source:\n"
        "  kind: local\n"
        "  publisher: Beispielverband\n"
        "  title: Strukturbericht 2026\n"
        "  path: daten/quellen/beleg.txt\n"
        "  published: 2026-03-11\n"
        "  retrieved: 2026-08-29\n"
        "---\n\n"
        "# Fast zwei Drittel der Betriebe haben weniger als zwanzig Beschaeftigte\n\n"
        "Von 12.480 erfassten Betrieben sind 61,4 Prozent klein. Das sagt, wer entscheidet.\n",
        encoding="utf-8",
    )
