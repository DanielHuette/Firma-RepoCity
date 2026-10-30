"""Writing the curated context file.

Context: The end of the curation. Only kept findings go in, each with its source, under a
header that states what the file is and that anything absent is unchecked. This file is
the only part of a run an agent session ever loads again. | Input: a run, its checks and
its decisions. | Output: the curated Markdown file, a structured companion and the
numbers behind it.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from itertools import groupby
from pathlib import Path

from agentic_marketing.errors import DecisionError
from agentic_marketing.models import (
    CompactionReport,
    Decision,
    Finding,
    RunManifest,
    StepField,
    Verdict,
    Verification,
)

CONTRACT_LINE = (
    "Every point here is backed by the source behind it. "
    "What is not here counts as unchecked and must not be invented."
)

FIELD_HEADING: dict[StepField, str] = {
    StepField.SOCIOCULTURAL: "Sociocultural",
    StepField.TECHNOLOGICAL: "Technological",
    StepField.ECONOMIC: "Economic",
    StepField.POLITICAL_LEGAL: "Political and legal",
}

LENS_TITLE = {
    "macro-step": "Macro analysis",
    "micro": "Micro analysis",
    "competitor": "Competitors",
    "porters-five": "Five forces",
    "reviews": "Review mining",
    "audience": "Audience",
}


def kept_findings(findings: Sequence[Finding], decisions: Sequence[Decision]) -> list[Finding]:
    """The findings the reviewer kept, in the run's original order.

    Args:
        findings: Every finding of the run.
        decisions: What the reviewer ruled.

    Returns:
        The kept findings.

    Raises:
        DecisionError: If a decision names a finding the run does not contain.
    """
    known = {finding.id for finding in findings}
    unknown = sorted({d.finding_id for d in decisions} - known)
    if unknown:
        raise DecisionError(f"decisions name findings the run does not contain: {unknown}")
    keep = {decision.finding_id for decision in decisions if decision.keep}
    return [finding for finding in findings if finding.id in keep]


def _body(manifest: RunManifest, kept: Sequence[Finding]) -> str:
    """Render the kept findings, grouped by STEP field when there is one."""
    if not kept:
        return "_Nothing from this run was kept._"
    if manifest.lens.value != "macro-step":
        return "\n".join(finding.to_markdown() for finding in kept)
    blocks: list[str] = []
    ordered = sorted(kept, key=lambda f: list(StepField).index(f.field) if f.field else 0)
    for field, group in groupby(ordered, key=lambda f: f.field):
        heading = FIELD_HEADING[field] if field else "Other"
        points = "\n".join(finding.to_markdown() for finding in group)
        blocks.append(f"## {heading}\n\n{points}")
    return "\n\n".join(blocks)


def compact(
    manifest: RunManifest,
    verifications: Sequence[Verification],
    decisions: Sequence[Decision],
) -> tuple[str, CompactionReport]:
    """Build the curated file content and the report that goes with it.

    Args:
        manifest: The run as it was read.
        verifications: The verdicts of the run.
        decisions: What the reviewer kept and dropped.

    Returns:
        The Markdown of the curated file, and the counts behind it.

    Raises:
        DecisionError: If a decision names a finding the run does not contain.
    """
    kept = kept_findings(manifest.findings, decisions)
    title = LENS_TITLE.get(manifest.lens.value, manifest.lens.value)
    sources = sorted({finding.source.address for finding in kept})
    header = [
        "---",
        f"title: {title}",
        f"lens: {manifest.lens.value}",
        f"subject: {manifest.subject}",
        f"run: {manifest.run_id}",
        f"last_updated: {manifest.produced.isoformat()}",
        f"kept: {len(kept)} of {len(manifest.findings)}",
        "sources:",
        *[f"  - {address}" for address in sources],
        "---",
        "",
        f"# {title}",
        "",
        CONTRACT_LINE,
        "",
        "",
    ]
    content = "\n".join(header) + _body(manifest, kept) + "\n"
    counts = dict.fromkeys(Verdict, 0)
    for verification in verifications:
        counts[verification.verdict] += 1
    report = CompactionReport(
        run_id=manifest.run_id,
        findings_in=len(manifest.findings),
        supported=counts[Verdict.SUPPORTED],
        partial=counts[Verdict.PARTIAL],
        unsupported=counts[Verdict.UNSUPPORTED],
        unreachable=counts[Verdict.UNREACHABLE],
        kept=len(kept),
        raw_chars=manifest.raw_chars,
        curated_chars=len(content),
    )
    return content, report


def sidecar(kept: Sequence[Finding]) -> str:
    """Render the structured companion the freshness scan reads."""
    payload = [
        {
            "finding_id": finding.id,
            "volatility": finding.volatility.value,
            "published": finding.source.published.isoformat(),
            "address": finding.source.address,
            "kind": finding.source.kind.value,
        }
        for finding in kept
    ]
    return json.dumps({"entries": payload}, indent=2) + "\n"


def _write_atomic(path: Path, content: str) -> Path:
    """Write a file so a reader never sees it half written."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)
    return path


def write_curated(
    content: str, target: Path, report: CompactionReport, kept: Sequence[Finding]
) -> Path:
    """Write the curated file, its companion and its report, atomically.

    Args:
        content: Markdown of the curated file.
        target: The curated file.
        report: Written next to it as JSON.
        kept: The kept findings, for the structured companion.

    Returns:
        The path of the curated file.
    """
    from agentic_marketing.workspace import report_file, sidecar_file

    _write_atomic(target, content)
    _write_atomic(sidecar_file(target), sidecar(kept))
    _write_atomic(report_file(target), report.model_dump_json(indent=2) + "\n")
    return target
