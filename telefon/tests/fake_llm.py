"""Scripted language model for behaviour tests of the agent.

Context: LiveKit Agents ships no fake model, and the real Qwen 3 model does not run in tests. |
Input: the answers the model should give, in order. | Output: an llm.LLM that replays them and
keeps every conversation it was shown.
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Never

from livekit.agents import llm
from livekit.agents.types import (
    DEFAULT_API_CONNECT_OPTIONS,
    NOT_GIVEN,
    APIConnectOptions,
    NotGivenOr,
)


@dataclass(frozen=True)
class ToolCall:
    """One tool call the model makes."""

    name: str
    arguments: Mapping[str, object]


@dataclass(frozen=True)
class Reply:
    """One answer of the model: text, tool calls or both."""

    text: str = ""
    tool_calls: tuple[ToolCall, ...] = ()


@dataclass
class Script:
    """Answers still to give and conversations already seen."""

    replies: list[Reply]
    seen: list[llm.ChatContext] = field(default_factory=list)


class FakeLLM(llm.LLM[Never]):
    """Replays scripted replies; fails the test when it is asked more than scripted."""

    def __init__(self, *replies: Reply) -> None:
        super().__init__()
        self.script = Script(list(replies))

    def chat(
        self,
        *,
        chat_ctx: llm.ChatContext,
        tools: list[llm.Tool] | None = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
        parallel_tool_calls: NotGivenOr[bool] = NOT_GIVEN,
        tool_choice: NotGivenOr[llm.ToolChoice] = NOT_GIVEN,
        extra_kwargs: NotGivenOr[dict[str, Any]] = NOT_GIVEN,
    ) -> "FakeStream":
        self.script.seen.append(chat_ctx.copy())
        if not self.script.replies:
            raise AssertionError("the model was asked more often than scripted")
        reply = self.script.replies.pop(0)
        return FakeStream(self, reply, chat_ctx=chat_ctx, tools=tools or [], conn=conn_options)


class FakeStream(llm.LLMStream):
    """Emits one scripted reply."""

    def __init__(
        self,
        model: FakeLLM,
        reply: Reply,
        *,
        chat_ctx: llm.ChatContext,
        tools: list[llm.Tool],
        conn: APIConnectOptions,
    ) -> None:
        super().__init__(model, chat_ctx=chat_ctx, tools=tools, conn_options=conn)
        self._reply = reply

    async def _run(self) -> None:
        calls = [
            llm.FunctionToolCall(
                name=call.name,
                arguments=json.dumps(call.arguments),
                call_id=f"call_{index}",
            )
            for index, call in enumerate(self._reply.tool_calls)
        ]
        delta = llm.ChoiceDelta(
            role="assistant", content=self._reply.text or None, tool_calls=calls
        )
        self._event_ch.send_nowait(llm.ChatChunk(id="fake", delta=delta))
