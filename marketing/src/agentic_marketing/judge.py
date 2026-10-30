"""Second verification pass: does the source actually carry the statement?

Context: The first pass proves that a number occurs in the source. It cannot see a
statement that quotes the right figure and draws the wrong conclusion from it, and it has
nothing to say about a finding that states no figure at all. This pass puts those two
cases in front of a model, which must answer through a forced tool call so nothing is
parsed out of prose, and must quote the passage it relies on. The model only ever
downgrades or confirms; it never invents a verdict for a source it could not read. |
Input: findings the first pass left open, and their source texts. | Output: one
Verification per finding, carrying the quoted evidence.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date
from typing import Any, Protocol, cast

from agentic_marketing.config import Settings
from agentic_marketing.errors import JudgeError
from agentic_marketing.models import Finding, Stage, Verdict, Verification

MAX_SOURCE_CHARS = 120_000
MAX_EVIDENCE_CHARS = 400
OPEN_VERDICTS = frozenset({Verdict.PARTIAL, Verdict.UNSUPPORTED, Verdict.NOT_CHECKED})

TOOL_NAME = "record_judgement"
TOOL_SCHEMA: dict[str, Any] = {
    "name": TOOL_NAME,
    "description": "Record whether the source passage carries the statement.",
    "input_schema": {
        "type": "object",
        "properties": {
            "verdict": {
                "type": "string",
                "enum": ["supported", "partial", "unsupported"],
                "description": (
                    "supported: the source states this. partial: the source states part of "
                    "it. unsupported: the source does not state it, or states otherwise."
                ),
            },
            "evidence": {
                "type": "string",
                "maxLength": MAX_EVIDENCE_CHARS,
                "description": "The passage from the source, quoted literally, that decides it.",
            },
            "note": {
                "type": "string",
                "maxLength": 300,
                "description": "What is missing or wrong, in one sentence. Empty when supported.",
            },
        },
        "required": ["verdict", "evidence"],
        "additionalProperties": False,
    },
}

PROMPT = """You are checking one marketing finding against the source it cites.

Statement:
{statement}

Detail:
{detail}

Source text:
<source>
{source}
</source>

Decide only what the source text supports. Do not use outside knowledge. Quote the
passage that decides it. If the source does not contain the passage, the verdict is
unsupported and the evidence is the closest passage you found.
Answer only through the {tool} tool."""


class JudgeClient(Protocol):
    """The slice of an Anthropic client this module uses.

    Declared as a protocol so tests pass a stub and the package carries no hard
    dependency on the vendor library.
    """

    def judge(self, prompt: str, model: str) -> dict[str, str]:
        """Return the recorded judgement as a mapping."""
        ...


class AnthropicJudge:
    """Judge backed by the Anthropic Messages API."""

    def __init__(self, api_key: str | None = None, *, max_tokens: int = 1024) -> None:
        try:
            from anthropic import Anthropic
        except ImportError as error:
            raise JudgeError(
                "the second pass needs the anthropic package: "
                "pip install 'agentic-marketing[judge]'"
            ) from error
        self._client = Anthropic(api_key=api_key) if api_key else Anthropic()
        self._max_tokens = max_tokens

    def judge(self, prompt: str, model: str) -> dict[str, str]:
        """Send one prompt and return the forced tool call.

        Args:
            prompt: The rendered checking prompt.
            model: Model identifier to use.

        Returns:
            The recorded judgement.

        Raises:
            JudgeError: If the model answered without using the tool.
        """
        message = self._client.messages.create(
            model=model,
            max_tokens=self._max_tokens,
            tools=[cast("Any", TOOL_SCHEMA)],
            tool_choice={"type": "tool", "name": TOOL_NAME},
            messages=[{"role": "user", "content": prompt}],
        )
        for block in message.content:
            if getattr(block, "type", None) == "tool_use":
                recorded = getattr(block, "input", None)
                if isinstance(recorded, dict):
                    return {str(key): str(value) for key, value in recorded.items()}
        raise JudgeError("the model answered without recording a judgement")


def build_prompt(finding: Finding, source_text: str) -> str:
    """Render the checking prompt for one finding."""
    return PROMPT.format(
        statement=finding.statement,
        detail=finding.detail,
        source=source_text[:MAX_SOURCE_CHARS],
        tool=TOOL_NAME,
    )


def judge_one(
    finding: Finding,
    source_text: str,
    client: JudgeClient,
    *,
    model: str,
    today: date | None = None,
) -> Verification:
    """Put one open finding in front of the model.

    Args:
        finding: The finding the first pass could not settle.
        source_text: Plain text of its source.
        client: Anything that answers the judge protocol.
        model: Model identifier.
        today: Date recorded as the check date; today when omitted.

    Returns:
        The verdict of the second pass, with the quoted passage.

    Raises:
        JudgeError: If the client returns a verdict outside the schema.
    """
    recorded = client.judge(build_prompt(finding, source_text), model)
    raw = recorded.get("verdict", "")
    try:
        verdict = Verdict(raw)
    except ValueError as error:
        raise JudgeError(f"the model returned the unknown verdict {raw!r}") from error
    if verdict not in {Verdict.SUPPORTED, Verdict.PARTIAL, Verdict.UNSUPPORTED}:
        raise JudgeError(f"the model returned the verdict {raw!r}, which it may not use")
    note = recorded.get("note") or None
    return Verification(
        finding_id=finding.id,
        stage=Stage.MODEL,
        verdict=verdict,
        evidence=(recorded.get("evidence") or None),
        checked=today or date.today(),
        note=note,
    )


def judge_open(
    findings: Sequence[Finding],
    first_pass: Sequence[Verification],
    texts: dict[str, str],
    client: JudgeClient,
    settings: Settings,
    *,
    today: date | None = None,
) -> list[Verification]:
    """Run the second pass over everything the first pass left open.

    A finding whose source could not be read stays unreachable: without the text there is
    nothing to judge, and a model asked anyway would answer from memory.

    Args:
        findings: The findings of the run.
        first_pass: The verdicts of the figure pass, in the same order.
        texts: Source texts keyed by address, as the figure pass collected them.
        client: Anything that answers the judge protocol.
        settings: Supplies the model identifier.
        today: Date recorded as the check date; today when omitted.

    Returns:
        The verdicts after the second pass, in input order. Settled findings are passed
        through untouched.
    """
    by_id = {finding.id: finding for finding in findings}
    results: list[Verification] = []
    for verification in first_pass:
        finding = by_id.get(verification.finding_id)
        text = texts.get(finding.source.address) if finding else None
        if finding is None or verification.verdict not in OPEN_VERDICTS or text is None:
            results.append(verification)
            continue
        results.append(judge_one(finding, text, client, model=settings.judge_model, today=today))
    return results
