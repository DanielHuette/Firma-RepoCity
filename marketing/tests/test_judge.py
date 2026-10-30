"""Tests for judge.

Context: The second pass must only ever run where there is text to judge, and must
refuse a verdict outside its schema. A stub client stands in for the vendor library. |
Input: findings and stubbed answers. | Output: assertions.
"""

from __future__ import annotations

import pytest

from agentic_marketing.config import Settings
from agentic_marketing.errors import JudgeError
from agentic_marketing.judge import TOOL_NAME, build_prompt, judge_one, judge_open
from agentic_marketing.models import Stage, Verdict
from tests.conftest import TODAY, make_finding, make_verification


class StubJudge:
    """A judge that answers whatever it was constructed with."""

    def __init__(self, answer: dict[str, str]) -> None:
        self.answer = answer
        self.prompts: list[str] = []

    def judge(self, prompt: str, model: str) -> dict[str, str]:
        self.prompts.append(prompt)
        return self.answer


def test_prompt_carries_statement_source_and_tool() -> None:
    prompt = build_prompt(make_finding(), "Quelltext")
    assert "Quelltext" in prompt
    assert TOOL_NAME in prompt
    assert make_finding().statement in prompt


def test_judgement_becomes_a_verification() -> None:
    client = StubJudge({"verdict": "supported", "evidence": "Steht so da."})
    result = judge_one(make_finding(), "Quelltext", client, model="m", today=TODAY)
    assert result.verdict is Verdict.SUPPORTED
    assert result.stage is Stage.MODEL
    assert result.evidence == "Steht so da."


def test_an_unknown_verdict_is_refused() -> None:
    client = StubJudge({"verdict": "vielleicht", "evidence": "x"})
    with pytest.raises(JudgeError, match="unknown verdict"):
        judge_one(make_finding(), "Quelltext", client, model="m")


def test_the_model_may_not_declare_a_source_unreachable() -> None:
    client = StubJudge({"verdict": "unreachable", "evidence": "x"})
    with pytest.raises(JudgeError, match="may not use"):
        judge_one(make_finding(), "Quelltext", client, model="m")


def test_settled_verdicts_are_passed_through() -> None:
    finding = make_finding()
    first = [make_verification(finding.id, Verdict.SUPPORTED)]
    client = StubJudge({"verdict": "unsupported", "evidence": "x"})
    result = judge_open([finding], first, {finding.source.address: "t"}, client, Settings())
    assert result[0].stage is Stage.FIGURES
    assert not client.prompts


def test_open_verdicts_go_to_the_model() -> None:
    finding = make_finding()
    first = [make_verification(finding.id, Verdict.PARTIAL)]
    client = StubJudge({"verdict": "unsupported", "evidence": "fehlt"})
    result = judge_open([finding], first, {finding.source.address: "t"}, client, Settings())
    assert result[0].stage is Stage.MODEL
    assert result[0].verdict is Verdict.UNSUPPORTED


def test_an_unreadable_source_is_never_judged() -> None:
    finding = make_finding()
    first = [make_verification(finding.id, Verdict.UNREACHABLE)]
    client = StubJudge({"verdict": "supported", "evidence": "erfunden"})
    result = judge_open([finding], first, {}, client, Settings())
    assert result[0].verdict is Verdict.UNREACHABLE
    assert not client.prompts
