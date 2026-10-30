"""Data model of findings, sources, verifications and decisions.

Context: A research run produces prose; this module turns it into records that can be
checked, decided on and counted. Nothing carries an expiry date: the publication date of
the source is stored and age is derived. | Input: parsed run files or model output. |
Output: validated objects and their Markdown representation.
"""

from __future__ import annotations

import re
from datetime import date
from enum import StrEnum
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

FINDING_ID_PATTERN = re.compile(r"[a-z0-9-]+/[a-z0-9-]{3,}")
MIN_STATEMENT_WORDS = 5
MAX_FIGURES = 12


class Lens(StrEnum):
    """The marketing method a finding was produced under."""

    MACRO_STEP = "macro-step"
    MICRO = "micro"
    COMPETITOR = "competitor"
    PORTERS_FIVE = "porters-five"
    REVIEWS = "reviews"
    AUDIENCE = "audience"


class StepField(StrEnum):
    """The four fields of a STEP macro analysis."""

    SOCIOCULTURAL = "sociocultural"
    TECHNOLOGICAL = "technological"
    ECONOMIC = "economic"
    POLITICAL_LEGAL = "political-legal"


class Horizon(StrEnum):
    """Whether a finding describes today or projects forward."""

    CURRENT = "current"
    FORECAST = "forecast"


class Volatility(StrEnum):
    """How fast this kind of finding goes stale. A classification, not an expiry."""

    PRICE = "price"
    MARKET = "market"
    STRUCTURAL = "structural"


class SourceKind(StrEnum):
    """Where a source lives, which decides how it is read."""

    WEB = "web"
    PDF = "pdf"
    LOCAL = "local"
    INTERNAL = "internal"


class Verdict(StrEnum):
    """Result of checking a finding against its source."""

    SUPPORTED = "supported"
    PARTIAL = "partial"
    UNSUPPORTED = "unsupported"
    UNREACHABLE = "unreachable"
    NOT_CHECKED = "not-checked"


class Stage(StrEnum):
    """Which pass produced a verdict."""

    FIGURES = "figures"
    MODEL = "model"


RECHECK_AFTER_DAYS: dict[Volatility, int | None] = {
    Volatility.PRICE: 90,
    Volatility.MARKET: 365,
    Volatility.STRUCTURAL: None,
}

KEEPABLE_VERDICTS = frozenset({Verdict.SUPPORTED, Verdict.PARTIAL})


def needs_recheck(volatility: Volatility, age_days: int) -> bool:
    """Tell whether a finding of this volatility is old enough to be looked at again.

    Args:
        volatility: How fast this kind of finding ages.
        age_days: Days since the source was published.

    Returns:
        True when the finding should be re-checked. It stays valid either way.
    """
    limit = RECHECK_AFTER_DAYS[volatility]
    return limit is not None and age_days > limit


class Source(BaseModel):
    """Where a finding comes from, precise enough to go back to it."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: SourceKind
    publisher: str = Field(min_length=2, description="Who published it, not the file name.")
    title: str = Field(min_length=3)
    url: str | None = Field(default=None, description="Absolute address, for web and pdf.")
    path: str | None = Field(default=None, description="Workspace-relative path, for local.")
    published: date = Field(description="Publication date of the information.")
    retrieved: date = Field(description="Day the source was last read.")
    locator: str | None = Field(default=None, description="Page, table or section.")

    @field_validator("url")
    @classmethod
    def _validate_url(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("http://", "https://")):
            raise ValueError(f"url must be absolute, got {value!r}")
        return value

    @model_validator(mode="after")
    def _require_address(self) -> Self:
        if self.kind in (SourceKind.WEB, SourceKind.PDF) and not self.url:
            raise ValueError(f"a {self.kind.value} source needs a url")
        if self.kind == SourceKind.LOCAL and not self.path:
            raise ValueError("a local source needs a path")
        if self.retrieved < self.published:
            raise ValueError("retrieved is before published")
        return self

    @property
    def address(self) -> str:
        """The url, the path, or the publisher for an internal source."""
        return self.url or self.path or self.publisher

    def age_days(self, reference: date | None = None) -> int:
        """Age of the information in days, counted from publication."""
        return ((reference or date.today()) - self.published).days

    def citation(self) -> str:
        """The source as one line, the way it appears under a curated point."""
        parts = [self.publisher, self.title]
        if self.locator:
            parts.append(self.locator)
        parts.append(self.published.isoformat())
        parts.append(self.address)
        return ", ".join(parts)


class Finding(BaseModel):
    """One marketing statement, the figures it rests on, and its source."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(description="<lens>/<slug>, unique within a run.")
    lens: Lens
    field: StepField | None = Field(default=None, description="Set for a STEP macro analysis.")
    horizon: Horizon
    volatility: Volatility

    statement: str = Field(min_length=20, description="The finding as one sentence.")
    detail: str = Field(min_length=40, description="Two to five sentences of substance.")
    figures: list[str] = Field(
        default_factory=list,
        max_length=MAX_FIGURES,
        description="Every number the statement rests on, as written in the source.",
    )
    source: Source

    @field_validator("id")
    @classmethod
    def _validate_id(cls, value: str) -> str:
        if not FINDING_ID_PATTERN.fullmatch(value):
            raise ValueError(f"id must be '<lens>/<slug>', got {value!r}")
        return value

    @field_validator("statement")
    @classmethod
    def _validate_statement_is_sentence(cls, value: str) -> str:
        statement = value.strip().rstrip(".")
        if len(statement.split()) < MIN_STATEMENT_WORDS:
            raise ValueError(f"statement is a heading, not a finding: {statement!r}")
        return statement

    @field_validator("figures")
    @classmethod
    def _strip_figures(cls, values: list[str]) -> list[str]:
        return [figure.strip() for figure in values if figure.strip()]

    @model_validator(mode="after")
    def _validate_field_matches_lens(self) -> Self:
        if self.lens is Lens.MACRO_STEP and self.field is None:
            raise ValueError("a macro-step finding needs a STEP field")
        if self.lens is not Lens.MACRO_STEP and self.field is not None:
            raise ValueError(f"a {self.lens.value} finding must not carry a STEP field")
        if not self.id.startswith(f"{self.lens.value}/"):
            raise ValueError(f"id {self.id!r} does not match lens {self.lens.value!r}")
        return self

    @property
    def slug(self) -> str:
        """The part of the id behind the lens."""
        return self.id.split("/", 1)[1]

    def to_markdown(self) -> str:
        """Render the finding as one bullet with its source line underneath.

        The detail is collapsed onto one line: a bullet that keeps the line breaks of
        the run file renders as ragged text in every viewer.
        """
        detail = " ".join(self.detail.split())
        return f"- **{self.statement}** {detail}\n  Source: {self.source.citation()}"


class Verification(BaseModel):
    """What checking a finding against its source produced."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    finding_id: str
    stage: Stage
    verdict: Verdict
    figures_found: list[str] = Field(default_factory=list)
    figures_missing: list[str] = Field(default_factory=list)
    evidence: str | None = Field(default=None, description="The passage that carries the claim.")
    checked: date
    note: str | None = Field(default=None, description="Why it failed, when it did.")

    @property
    def keepable(self) -> bool:
        """Whether this verdict allows the finding into a curated file."""
        return self.verdict in KEEPABLE_VERDICTS


class Decision(BaseModel):
    """A human verdict on one finding."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    finding_id: str
    keep: bool
    note: str | None = Field(default=None, description="Why, in the reviewer's words.")
    decided: date


class RunManifest(BaseModel):
    """What one research run contained, before anything was decided."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str = Field(min_length=3, description="Folder name of the run.")
    lens: Lens
    subject: str = Field(min_length=2, description="Company or product the run was about.")
    produced: date
    findings: list[Finding]
    raw_chars: int = Field(ge=0, description="Characters of the raw run.")

    @model_validator(mode="after")
    def _validate_findings(self) -> Self:
        if not self.findings:
            raise ValueError(f"run {self.run_id!r} holds no finding")
        seen: set[str] = set()
        for finding in self.findings:
            if finding.id in seen:
                raise ValueError(f"duplicate finding id {finding.id!r}")
            seen.add(finding.id)
            if finding.lens is not self.lens:
                raise ValueError(f"finding {finding.id!r} does not match lens {self.lens.value!r}")
        return self


class CompactionReport(BaseModel):
    """The numbers of one curation, written next to the curated file."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str
    findings_in: int = Field(ge=0)
    supported: int = Field(ge=0)
    partial: int = Field(ge=0)
    unsupported: int = Field(ge=0)
    unreachable: int = Field(ge=0)
    kept: int = Field(ge=0)
    raw_chars: int = Field(ge=0)
    curated_chars: int = Field(ge=0)

    @property
    def shrink_ratio(self) -> float:
        """Curated size as a fraction of the raw run, 0.0 when the run was empty."""
        return self.curated_chars / self.raw_chars if self.raw_chars else 0.0


class PackedFile(BaseModel):
    """One file inside a context pack, with what it costs."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str
    chars: int = Field(ge=0)
    tokens: int = Field(ge=0)


class ContextPack(BaseModel):
    """The set of files an agent session starts with, and its measured size."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    files: list[PackedFile]
    budget: int = Field(gt=0)

    @property
    def chars(self) -> int:
        """Total characters of the pack."""
        return sum(packed.chars for packed in self.files)

    @property
    def tokens(self) -> int:
        """Total tokens of the pack."""
        return sum(packed.tokens for packed in self.files)

    @property
    def within_budget(self) -> bool:
        """Whether the pack fits the configured budget."""
        return self.tokens <= self.budget
