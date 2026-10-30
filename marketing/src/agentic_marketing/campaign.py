"""Campaigns: posts written from curated findings, guarded and handed to the cockpit.

Context: A campaign is a folder in the workspace. It names the research runs it draws on and
holds one Markdown file per post. Before anything reaches the cockpit, every number a post
shows is matched against the figures of the findings it cites, so a post cannot carry a
figure no source backs. | Input: a campaign folder and the runs it names. | Output: validated
specifications, the guard result per post, and the rows written to the cockpit.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import time
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from agentic_marketing.cockpit import CockpitClient
from agentic_marketing.errors import CampaignError, RunError
from agentic_marketing.models import Decision, Finding, Verification
from agentic_marketing.runs import read_run
from agentic_marketing.text import figure_variants, numbers_in, slugify
from agentic_marketing.tracking import mark_links, markers_for

logger = logging.getLogger(__name__)

CAMPAIGN_FILE = "kampagne.yaml"
POSTS_FOLDER = "beitraege"
SLUG_PATTERN = r"^[a-z0-9-]{3,}$"
EDITABLE_STATUSES = frozenset({"draft", "review", "rejected"})
YEAR_RANGE = range(1990, 2101)


class CampaignSpec(BaseModel):
    """What a campaign wants, where it publishes and which research it rests on."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    slug: str = Field(pattern=SLUG_PATTERN)
    title: str = Field(min_length=5)
    product: str = Field(min_length=2)
    goal: str = Field(min_length=10)
    audience: str = Field(min_length=10)
    duration_days: int = Field(default=28, ge=1, le=365)
    publish_time: time = Field(default=time(9, 0))
    kpi: dict[str, int] = Field(default_factory=dict)
    runs: list[str] = Field(min_length=1, description="Run folders, relative to the workspace.")


class PostSpec(BaseModel):
    """One post of a campaign, as written in its Markdown file."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    channel: str = Field(pattern=r"^(blog|linkedin)$")
    slug: str = Field(pattern=SLUG_PATTERN)
    title: str = Field(min_length=5)
    summary: str = Field(default="")
    day_offset: int = Field(default=0, ge=0)
    findings: list[str] = Field(min_length=1, description="Ids of the findings the post cites.")
    free_figures: list[str] = Field(
        default_factory=list, description="Numbers that are not claims, such as a step count."
    )
    body: str = Field(min_length=40)

    @field_validator("free_figures")
    @classmethod
    def _strip(cls, values: list[str]) -> list[str]:
        return [value.strip() for value in values if value.strip()]


@dataclass(frozen=True, slots=True)
class CheckedFinding:
    """A finding with its verdict and whether a person kept it."""

    finding: Finding
    verification: Verification | None
    kept: bool

    @property
    def citable(self) -> bool:
        """Whether a post may cite it: kept by a person and backed by its source."""
        return self.kept and self.verification is not None and self.verification.keepable


@dataclass(frozen=True, slots=True)
class PushReport:
    """What one push changed in the cockpit."""

    campaign_id: str
    findings: int
    created: int
    updated: int
    kept_as_is: tuple[str, ...]
    blocked: tuple[str, ...]


def _split_frontmatter(text: str, path: Path) -> tuple[dict[str, Any], str]:
    if not text.startswith("---\n"):
        raise CampaignError(f"{path} does not start with a front matter block")
    try:
        head, body = text[4:].split("\n---\n", 1)
        meta = yaml.safe_load(head) or {}
    except (ValueError, yaml.YAMLError) as error:
        raise CampaignError(f"{path}: cannot read the front matter: {error}") from error
    if not isinstance(meta, dict):
        raise CampaignError(f"{path}: the front matter must be a mapping")
    return meta, body.strip()


def load_campaign(folder: Path) -> tuple[CampaignSpec, list[PostSpec]]:
    """Read a campaign folder.

    Args:
        folder: Folder holding `kampagne.yaml` and the `beitraege/` subfolder.

    Returns:
        The campaign and its posts, ordered by publication day and file name.

    Raises:
        CampaignError: If a file is missing or invalid, or two posts share a slug.
    """
    spec_path = folder / CAMPAIGN_FILE
    if not spec_path.is_file():
        raise CampaignError(f"{spec_path} does not exist")
    try:
        spec = CampaignSpec(**yaml.safe_load(spec_path.read_text(encoding="utf-8")))
    except (yaml.YAMLError, TypeError, ValidationError) as error:
        raise CampaignError(f"{spec_path}: {error}") from error
    posts: list[PostSpec] = []
    for path in sorted((folder / POSTS_FOLDER).glob("*.md")):
        meta, body = _split_frontmatter(path.read_text(encoding="utf-8"), path)
        try:
            posts.append(PostSpec(**meta, body=body))
        except ValidationError as error:
            raise CampaignError(f"{path}: {error}") from error
    if not posts:
        raise CampaignError(f"{folder / POSTS_FOLDER} holds no post")
    keys = [(post.channel, post.slug) for post in posts]
    if len(keys) != len(set(keys)):
        raise CampaignError(f"{folder}: two posts share channel and slug")
    return spec, sorted(posts, key=lambda post: post.day_offset)


def _read_json(path: Path) -> Any:
    if not path.is_file():
        raise RunError(f"{path} does not exist; verify and decide the run first")
    return json.loads(path.read_text(encoding="utf-8"))


def collect_findings(workspace: Path, spec: CampaignSpec) -> list[CheckedFinding]:
    """Gather every finding of the runs a campaign names, with verdict and decision.

    Raises:
        RunError: If a run lacks its verifications or decisions.
    """
    collected: list[CheckedFinding] = []
    for relative in spec.runs:
        run = workspace / relative
        manifest = read_run(run)
        verdicts = {
            item.finding_id: item
            for item in (Verification(**entry) for entry in _read_json(run / "verifications.json"))
        }
        payload = _read_json(run / "decisions.json")
        decisions = {
            item.finding_id: item
            for item in (Decision(**entry) for entry in payload.get("decisions", []))
        }
        for finding in manifest.findings:
            decision = decisions.get(finding.id)
            collected.append(
                CheckedFinding(finding, verdicts.get(finding.id), bool(decision and decision.keep))
            )
    return collected


def _is_year(number: str) -> bool:
    return number.isdigit() and len(number) == 4 and int(number) in YEAR_RANGE


def unbacked_figures(post: PostSpec, cited: Sequence[Finding]) -> list[str]:
    """Numbers a post shows that none of its cited findings backs.

    Years are allowed, because a date is not a claim. A figure that is written with words, such
    as the date `1. Januar 2026`, is taken out of the text whole before the numbers are read, so
    its digits are not checked one by one. Numbers the post declares as free, such as the count
    of steps in a list, are allowed and stay visible to the reviewer.

    Args:
        post: The post to check.
        cited: The findings the post cites.

    Returns:
        The offending numbers as written in the post, each once, in order.
    """
    allowed: set[str] = set()
    for figure in [figure for finding in cited for figure in finding.figures] + post.free_figures:
        allowed |= figure_variants(figure)
    text = f"{post.title}\n{post.summary}\n{post.body}"
    for spelling in sorted(allowed, key=len, reverse=True):
        if any(character.isalpha() for character in spelling):
            text = text.replace(spelling, " ")
    missing: list[str] = []
    for number in numbers_in(text):
        if number in allowed or _is_year(number) or number in missing:
            continue
        missing.append(number)
    return missing


def _finding_row(campaign_id: str, item: CheckedFinding) -> dict[str, Any]:
    finding, verification = item.finding, item.verification
    return {
        "campaign_id": campaign_id,
        "key": finding.id,
        "statement": finding.statement,
        "detail": finding.detail,
        "figures": finding.figures,
        "source_url": finding.source.url,
        "source_publisher": finding.source.publisher,
        "source_title": finding.source.title,
        "source_published": finding.source.published.isoformat(),
        "verdict": verification.verdict.value if verification else "not-checked",
        "evidence": verification.evidence if verification else None,
        "checked_on": verification.checked.isoformat() if verification else None,
    }


def _campaign_row(spec: CampaignSpec) -> dict[str, Any]:
    return {
        "slug": spec.slug,
        "title": spec.title,
        "product": spec.product,
        "goal": spec.goal,
        "audience": spec.audience,
        "target": "repocity",
        "is_example": False,
        "duration_days": spec.duration_days,
        "publish_time": spec.publish_time.isoformat(timespec="minutes"),
        "kpi": spec.kpi,
    }


def push_campaign(
    client: CockpitClient,
    spec: CampaignSpec,
    posts: Sequence[PostSpec],
    findings: Sequence[CheckedFinding],
) -> PushReport:
    """Bring a campaign into the cockpit, ready for review.

    Posts already approved or published are left untouched, so a second push never
    overrides a decision. Every other post is written with status `review` and the result of
    the figure guard; a post citing a finding that was not kept or not backed stops the push.

    Raises:
        CampaignError: If a post cites an unknown or uncitable finding.
    """
    by_id = {item.finding.id: item for item in findings}
    for post in posts:
        for key in post.findings:
            if key not in by_id:
                raise CampaignError(
                    f"post {post.slug} cites {key}, which no run of the campaign holds"
                )
            if not by_id[key].citable:
                raise CampaignError(
                    f"post {post.slug} cites {key}, which was dropped or is not backed"
                )

    existing_campaign = client.select(
        "campaigns", {"slug": f"eq.{spec.slug}", "select": "id,status"}
    )
    row = _campaign_row(spec)
    if not existing_campaign:
        row["status"] = "ready"
    campaign = client.upsert("campaigns", [row], on_conflict="slug")[0]
    campaign_id = str(campaign["id"])

    stored = client.upsert(
        "findings",
        [_finding_row(campaign_id, item) for item in findings],
        on_conflict="campaign_id,key",
    )
    finding_ids = {row_["key"]: str(row_["id"]) for row_ in stored}

    current = {
        (row_["channel"], row_["slug"]): row_
        for row_ in client.select(
            "posts", {"campaign_id": f"eq.{campaign_id}", "select": "id,channel,slug,status"}
        )
    }
    created = updated = 0
    kept_as_is: list[str] = []
    blocked: list[str] = []
    for post in posts:
        before = current.get((post.channel, post.slug))
        if before is not None and before["status"] not in EDITABLE_STATUSES:
            kept_as_is.append(post.slug)
            continue
        missing = unbacked_figures(post, [by_id[key].finding for key in post.findings])
        if missing:
            blocked.append(post.slug)
        values = {
            "campaign_id": campaign_id,
            "channel": post.channel,
            "slug": post.slug,
            "title": post.title,
            "summary": post.summary,
            "body_md": mark_links(post.body, markers_for(post.channel, spec.slug, post.slug)),
            "day_offset": post.day_offset,
            "status": "review",
            "unbacked_figures": missing,
            "free_figures": post.free_figures,
        }
        saved = client.upsert("posts", [values], on_conflict="campaign_id,channel,slug")[0]
        post_id = str(saved["id"])
        client.delete("post_findings", {"post_id": f"eq.{post_id}"})
        client.insert(
            "post_findings",
            [{"post_id": post_id, "finding_id": finding_ids[key]} for key in post.findings],
        )
        created += before is None
        updated += before is not None
    client.log_event(
        campaign_id, "pushed", note=f"{created} new, {updated} updated, {len(kept_as_is)} unchanged"
    )
    return PushReport(campaign_id, len(stored), created, updated, tuple(kept_as_is), tuple(blocked))


def new_post_file(folder: Path, channel: str, title: str, findings: Sequence[str]) -> Path:
    """Write the skeleton of a post file, the shape the drafting skills fill in."""
    slug = slugify(title)[:60].strip("-")
    target = folder / POSTS_FOLDER / f"{channel}-{slug}.md"
    meta = {
        "channel": channel,
        "slug": slug,
        "title": title,
        "summary": "",
        "day_offset": 0,
        "findings": list(findings),
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        f"---\n{yaml.safe_dump(meta, allow_unicode=True, sort_keys=False)}---\n\n", encoding="utf-8"
    )
    return target
