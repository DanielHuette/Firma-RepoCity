"""First verification pass: do the figures occur in the source?

Context: Structured output is not correct output. This pass fetches each source once and
looks for every figure a finding rests on, which catches an invented number before a
human ever reads it. It is deterministic, needs no model and costs nothing. What it
cannot judge is whether the statement around a correct number is true; that is the
second pass in judge.py. | Input: findings. | Output: one Verification per finding.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date
from pathlib import Path

from agentic_marketing.config import Settings
from agentic_marketing.errors import SourceError
from agentic_marketing.models import Finding, Stage, Verdict, Verification
from agentic_marketing.sources import extract_text
from agentic_marketing.text import contains_figure, sentence_with_figure


def verify_one(finding: Finding, text: str, *, today: date | None = None) -> Verification:
    """Check one finding against already extracted source text.

    Args:
        finding: The finding to check.
        text: Plain text of its source.
        today: Date recorded as the check date; today when omitted.

    Returns:
        The verdict, with the figures found and missing. A finding that states no figure
        gets NOT_CHECKED, because this pass has nothing to compare.
    """
    checked = today or date.today()
    if not finding.figures:
        return Verification(
            finding_id=finding.id,
            stage=Stage.FIGURES,
            verdict=Verdict.NOT_CHECKED,
            checked=checked,
            note="the finding states no figure this pass could look for",
        )
    found = [figure for figure in finding.figures if contains_figure(text, figure)]
    missing = [figure for figure in finding.figures if figure not in found]
    if not missing:
        verdict = Verdict.SUPPORTED
    elif found:
        verdict = Verdict.PARTIAL
    else:
        verdict = Verdict.UNSUPPORTED
    evidence = sentence_with_figure(text, found[0]) if found else None
    return Verification(
        finding_id=finding.id,
        stage=Stage.FIGURES,
        verdict=verdict,
        figures_found=found,
        figures_missing=missing,
        evidence=evidence,
        checked=checked,
    )


def verify_all(
    findings: Sequence[Finding],
    root: Path,
    settings: Settings,
    *,
    today: date | None = None,
) -> tuple[list[Verification], dict[str, str]]:
    """Check every finding, reading each distinct source exactly once.

    Args:
        findings: The findings of one run.
        root: Workspace root, for local sources.
        settings: Timeout and contact address.
        today: Date recorded as the check date; today when omitted.

    Returns:
        One verification per finding in input order, and the extracted source texts keyed
        by source address, so the second pass does not fetch them again.
    """
    checked = today or date.today()
    texts: dict[str, str] = {}
    failures: dict[str, str] = {}
    results: list[Verification] = []
    for finding in findings:
        address = finding.source.address
        if address not in texts and address not in failures:
            try:
                texts[address] = extract_text(finding.source, root, settings)
            except SourceError as error:
                failures[address] = str(error)
        if address in failures:
            results.append(
                Verification(
                    finding_id=finding.id,
                    stage=Stage.FIGURES,
                    verdict=Verdict.UNREACHABLE,
                    figures_missing=list(finding.figures),
                    checked=checked,
                    note=failures[address],
                )
            )
            continue
        results.append(verify_one(finding, texts[address], today=checked))
    return results, texts
