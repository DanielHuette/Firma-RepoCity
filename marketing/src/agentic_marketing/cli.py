"""Command line of the package.

Context: The only module that prints. Every command resolves the workspace, calls one
stage and formats its result; no logic lives here. | Input: argv. | Output: process exit
code.

Usage:
    agentic-marketing new <target> [--force]
    agentic-marketing check
    agentic-marketing verify <run> [--model] [--offline]
    agentic-marketing review <run>
    agentic-marketing apply <run> [--auto]
    agentic-marketing pack [--extra <path>]... [--out <file>]
    agentic-marketing stale [--offline]
    agentic-marketing campaign <folder>
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from collections.abc import Sequence
from pathlib import Path

from agentic_marketing import __version__
from agentic_marketing.config import Settings, load_settings
from agentic_marketing.errors import AgenticMarketingError
from agentic_marketing.models import Verification
from agentic_marketing.pack import build_pack
from agentic_marketing.report import format_check, format_compaction, format_pack, format_stale
from agentic_marketing.workspace import check_layout, curated_file, resolve_root, scaffold

VERIFICATIONS_NAME = "verifications.json"
logger = logging.getLogger(__name__)


def build_parser() -> argparse.ArgumentParser:
    """Assemble the parser with every subcommand."""
    parser = argparse.ArgumentParser(prog="agentic-marketing", description=__doc__.split("\n")[0])
    parser.add_argument("--version", action="version", version=__version__)
    parser.add_argument("--verbose", action="store_true", help="log what is being read and written")
    subparsers = parser.add_subparsers(dest="command", required=True)

    new = subparsers.add_parser("new", help="write a fresh workspace from the template")
    new.add_argument("target", type=Path)
    new.add_argument("--force", action="store_true", help="overwrite an existing workspace")

    subparsers.add_parser("check", help="report what the workspace is missing")

    verify = subparsers.add_parser("verify", help="check every figure of a run against its source")
    verify.add_argument("run", type=Path)
    verify.add_argument("--model", action="store_true", help="add the second, model-backed pass")
    verify.add_argument("--offline", action="store_true", help="skip sources that need the network")

    review = subparsers.add_parser("review", help="build the page the decisions are made on")
    review.add_argument("run", type=Path)

    apply_ = subparsers.add_parser("apply", help="write the curated file from the decisions")
    apply_.add_argument("run", type=Path)
    apply_.add_argument(
        "--auto", action="store_true", help="decide by verdict instead of by a person"
    )

    pack = subparsers.add_parser("pack", help="assemble and measure the session context")
    pack.add_argument("--extra", action="append", default=[], metavar="PATH")
    pack.add_argument("--out", type=Path, help="write the pack here instead of to the screen")

    stale = subparsers.add_parser("stale", help="report curated points that are due")
    stale.add_argument("--offline", action="store_true", help="skip the address check")

    campaign = subparsers.add_parser("campaign", help="check a campaign and hand it to the cockpit")
    campaign.add_argument("folder", type=Path, help="campaign folder holding kampagne.yaml")

    return parser


def _run_paths(run: Path) -> tuple[Path, Path, Path]:
    """The run folder and the two files that live beside it."""
    from agentic_marketing.review import DECISIONS_NAME, PAGE_NAME

    return run / VERIFICATIONS_NAME, run / DECISIONS_NAME, run / PAGE_NAME


def _load_verifications(path: Path) -> list[Verification]:
    """Read the stored verdicts of a run."""
    from agentic_marketing.errors import RunError

    if not path.is_file():
        raise RunError(f"{path} does not exist; run verify first")
    payload = json.loads(path.read_text(encoding="utf-8"))
    return [Verification(**entry) for entry in payload]


def _cmd_new(args: argparse.Namespace, settings: Settings) -> int:
    del settings
    written = scaffold(args.target, force=args.force)
    print(f"Wrote {len(written)} files to {args.target}")
    print("Fill stammdaten/ and strategie/, then run: agentic-marketing check")
    return 0


def _cmd_check(args: argparse.Namespace, settings: Settings) -> int:
    del args
    check = check_layout(resolve_root(settings.workspace))
    print(format_check(check))
    return 0 if check.ok else 1


def _cmd_verify(args: argparse.Namespace, settings: Settings) -> int:
    from agentic_marketing.runs import read_run
    from agentic_marketing.verify import verify_all

    root = resolve_root(settings.workspace)
    manifest = read_run(args.run)
    results, texts = verify_all(manifest.findings, root, settings)
    if args.model:
        from agentic_marketing.judge import AnthropicJudge, judge_open

        results = judge_open(manifest.findings, results, texts, AnthropicJudge(), settings)
    target, _, _ = _run_paths(args.run)
    payload = [json.loads(item.model_dump_json()) for item in results]
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    counts: dict[str, int] = {}
    for item in results:
        counts[item.verdict.value] = counts.get(item.verdict.value, 0) + 1
    summary = ", ".join(f"{count} {verdict}" for verdict, count in sorted(counts.items()))
    print(f"{manifest.run_id}: {len(results)} findings checked - {summary}")
    print(f"Written to {target}")
    return 0


def _cmd_review(args: argparse.Namespace, settings: Settings) -> int:
    del settings
    from agentic_marketing.review import build_page, write_page
    from agentic_marketing.runs import read_run

    manifest = read_run(args.run)
    verifications_path, decisions_path, page_path = _run_paths(args.run)
    verifications = _load_verifications(verifications_path)
    page = build_page(
        manifest.findings, verifications, run_id=manifest.run_id, decisions_path=decisions_path
    )
    write_page(page, page_path)
    print(f"Open {page_path}, decide, and save the file as {decisions_path}")
    return 0


def _cmd_apply(args: argparse.Namespace, settings: Settings) -> int:
    from agentic_marketing.compact import compact, kept_findings, write_curated
    from agentic_marketing.review import keep_supported, read_decisions, write_decisions
    from agentic_marketing.runs import read_run

    root = resolve_root(settings.workspace)
    manifest = read_run(args.run)
    verifications_path, decisions_path, _ = _run_paths(args.run)
    verifications = _load_verifications(verifications_path)
    if args.auto:
        decisions = keep_supported(manifest.findings, verifications)
        write_decisions(decisions, decisions_path, run_id=manifest.run_id)
    else:
        decisions = read_decisions(decisions_path, run_id=manifest.run_id)
    content, report = compact(manifest, verifications, decisions)
    target = curated_file(root, manifest.lens)
    write_curated(content, target, report, kept_findings(manifest.findings, decisions))
    print(format_compaction(report))
    print(f"Written to {target}")
    return 0


def _cmd_pack(args: argparse.Namespace, settings: Settings) -> int:
    root = resolve_root(settings.workspace)
    text, pack = build_pack(root, budget=settings.pack_budget, extra=args.extra)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    print(format_pack(pack))
    if args.out:
        print(f"Written to {args.out}")
    return 0


def _cmd_stale(args: argparse.Namespace, settings: Settings) -> int:
    from agentic_marketing.freshness import scan

    root = resolve_root(settings.workspace)
    entries = list(scan(root, settings, check_addresses=not args.offline))
    print(format_stale(entries))
    return 0


def _cmd_campaign(args: argparse.Namespace, settings: Settings) -> int:
    from agentic_marketing.campaign import collect_findings, load_campaign, push_campaign
    from agentic_marketing.cockpit import CockpitClient

    root = resolve_root(settings.workspace)
    spec, posts = load_campaign(args.folder)
    findings = collect_findings(root, spec)
    with CockpitClient.from_settings(settings) as client:
        result = push_campaign(client, spec, posts, findings)
    print(
        f"{spec.slug}: {result.findings} findings, {result.created} new posts, "
        f"{result.updated} updated, {len(result.kept_as_is)} already decided"
    )
    if result.blocked:
        print("Figures without a source, approval blocked: " + ", ".join(result.blocked))
    return 0


COMMANDS = {
    "new": _cmd_new,
    "check": _cmd_check,
    "verify": _cmd_verify,
    "review": _cmd_review,
    "apply": _cmd_apply,
    "pack": _cmd_pack,
    "stale": _cmd_stale,
    "campaign": _cmd_campaign,
}


def main(argv: Sequence[str] | None = None) -> int:
    """Run one command.

    Args:
        argv: Arguments without the program name; sys.argv when omitted.

    Returns:
        0 on success, 1 on a handled error, 2 on bad usage.
    """
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )
    try:
        return COMMANDS[args.command](args, load_settings())
    except AgenticMarketingError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
