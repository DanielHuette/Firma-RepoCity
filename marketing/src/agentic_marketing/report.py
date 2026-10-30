"""Turning the numbers into lines a person reads.

Context: The claim this project makes is that curation shrinks a research run by an order
of magnitude without losing its sources. That only counts if it is stated as a number
after every run. | Input: reports, packs and stale entries. | Output: formatted blocks.
"""

from __future__ import annotations

from collections.abc import Sequence

from agentic_marketing.freshness import StaleEntry
from agentic_marketing.models import CompactionReport, ContextPack
from agentic_marketing.workspace import WorkspaceCheck


def format_compaction(report: CompactionReport) -> str:
    """One block: what came in, what held up, how much is left."""
    percent = report.shrink_ratio * 100
    dropped = report.findings_in - report.kept
    return "\n".join(
        [
            f"Run {report.run_id}",
            f"  findings      {report.findings_in}",
            f"  supported     {report.supported}",
            f"  partial       {report.partial}",
            f"  unsupported   {report.unsupported}",
            f"  unreachable   {report.unreachable}",
            f"  kept          {report.kept}   dropped {dropped}",
            f"  raw           {report.raw_chars:,} characters",
            f"  curated       {report.curated_chars:,} characters   ({percent:.1f} % of the run)",
        ]
    )


def format_pack(pack: ContextPack) -> str:
    """One block: the files of the pack, their size and the budget left."""
    lines = ["Context pack"]
    width = max((len(packed.path) for packed in pack.files), default=0)
    for packed in pack.files:
        lines.append(
            f"  {packed.path.ljust(width)}  {packed.chars:>7,} chars  ~{packed.tokens:>6,} tokens"
        )
    left = pack.budget - pack.tokens
    lines.append(
        f"  {'total'.ljust(width)}  {pack.chars:>7,} chars  ~{pack.tokens:>6,} tokens"
        f"   budget {pack.budget:,}, {left:,} left"
    )
    return "\n".join(lines)


def format_stale(entries: Sequence[StaleEntry]) -> str:
    """One block: what is due for a re-check, oldest first."""
    if not entries:
        return "Nothing is due for a re-check."
    ordered = sorted(entries, key=lambda entry: entry.age_days, reverse=True)
    lines = [f"{len(ordered)} points want looking at again"]
    for entry in ordered:
        lines.append(f"  {entry.finding_id}  {entry.age_days} days  {entry.reason}")
        lines.append(f"    in {entry.file}")
    return "\n".join(lines)


def format_check(check: WorkspaceCheck) -> str:
    """One block: what the workspace is missing."""
    if check.ok:
        return f"{check.root} is complete."
    lines = [f"{check.root} is incomplete"]
    for folder in check.missing_folders:
        lines.append(f"  missing folder  {folder}")
    for name in check.missing_base_files:
        lines.append(f"  missing file    {name}")
    return "\n".join(lines)
