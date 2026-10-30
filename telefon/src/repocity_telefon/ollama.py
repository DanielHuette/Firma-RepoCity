"""Language model plugin for LiveKit Agents that talks to a local Ollama server.

Context: answers come from a Qwen 3 model in Ollama on the RepoCity server, through Ollama's own
chat interface (/api/chat), so no cloud service and no third-party client library is involved. |
Input: the conversation and the tools of the agent. | Output: streamed text and tool calls, and
short summaries of finished calls.
"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Any, Never
from uuid import uuid4

import httpx
from livekit.agents import APIConnectionError, APIStatusError, APITimeoutError, llm
from livekit.agents.types import (
    DEFAULT_API_CONNECT_OPTIONS,
    NOT_GIVEN,
    APIConnectOptions,
    NotGivenOr,
)

from .errors import ModelError

logger = logging.getLogger(__name__)

SUMMARY_INSTRUCTIONS = (
    "Fasse das folgende Telefongespräch in höchstens drei Sätzen auf Deutsch zusammen: wer "
    "angerufen hat, was er wollte und was vereinbart wurde. Erfinde nichts."
)
EMPTY_CALL_SUMMARY = "Der Anrufer hat nichts gesagt."


def _text_of(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(part["text"] for part in content if part.get("type") == "text")
    return ""


def _ollama_message(message: dict[str, Any]) -> dict[str, Any]:
    role = "system" if message["role"] == "developer" else message["role"]
    converted: dict[str, Any] = {"role": role, "content": _text_of(message.get("content"))}
    if role == "tool":
        converted["tool_name"] = message.get("name", "")
    if message.get("tool_calls"):
        converted["tool_calls"] = [
            {
                "function": {
                    "name": call["function"]["name"],
                    "arguments": json.loads(call["function"]["arguments"] or "{}"),
                }
            }
            for call in message["tool_calls"]
        ]
    return converted


def to_ollama_messages(chat_ctx: llm.ChatContext) -> list[dict[str, Any]]:
    """Convert a LiveKit conversation into the message list of Ollama's /api/chat.

    Args:
        chat_ctx: Conversation including instructions, tool calls and tool results.

    Returns:
        Messages with roles system, user, assistant and tool.
    """
    messages, _ = chat_ctx.to_provider_format("openai", inject_dummy_user_message=False)
    tool_names = {
        item.call_id: item.name for item in chat_ctx.items if item.type == "function_call_output"
    }
    for message in messages:
        if message["role"] == "tool":
            message["name"] = tool_names.get(message.get("tool_call_id", ""), "")
    return [_ollama_message(message) for message in messages]


def to_ollama_tools(tools: list[llm.Tool]) -> list[dict[str, Any]]:
    """Describe function tools in the JSON schema format Ollama expects.

    Args:
        tools: Tools of the agent.

    Returns:
        One `{"type": "function", "function": {...}}` entry per function tool.
    """
    return llm.ToolContext(tools).parse_function_tools("openai", strict=False)


def _tool_calls(message: dict[str, Any]) -> list[llm.FunctionToolCall]:
    return [
        llm.FunctionToolCall(
            name=call["function"]["name"],
            arguments=json.dumps(call["function"].get("arguments") or {}, ensure_ascii=False),
            call_id=f"call_{uuid4().hex[:12]}",
        )
        for call in message.get("tool_calls") or []
    ]


def _chunk_from_line(line: str, request_id: str) -> llm.ChatChunk | None:
    data = json.loads(line)
    if "error" in data:
        raise APIStatusError(str(data["error"]), status_code=500, retryable=False)
    if data.get("done"):
        prompt, completion = data.get("prompt_eval_count", 0), data.get("eval_count", 0)
        usage = llm.CompletionUsage(
            completion_tokens=completion, prompt_tokens=prompt, total_tokens=prompt + completion
        )
        return llm.ChatChunk(id=request_id, usage=usage)
    message = data.get("message") or {}
    content, calls = message.get("content") or None, _tool_calls(message)
    if content is None and not calls:
        return None
    delta = llm.ChoiceDelta(role="assistant", content=content, tool_calls=calls)
    return llm.ChatChunk(id=request_id, delta=delta)


class OllamaLLM(llm.LLM[Never]):
    """Chat model served by Ollama."""

    def __init__(
        self,
        *,
        base_url: str,
        model: str,
        temperature: float = 0.3,
        keep_alive: str = "30m",
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        """Create the plugin.

        Args:
            base_url: Address of the Ollama server, e.g. http://ollama:11434.
            model: Model tag, e.g. qwen3:8b.
            temperature: Sampling temperature; low keeps answers close to the facts.
            keep_alive: How long Ollama keeps the model in GPU memory between calls.
            transport: Replacement transport, used by tests.
        """
        super().__init__()
        self._model = model
        self._options = {"temperature": temperature}
        self._keep_alive = keep_alive
        self._http = httpx.AsyncClient(base_url=base_url.rstrip("/"), transport=transport)

    @property
    def model(self) -> str:
        """Model tag served by Ollama."""
        return self._model

    @property
    def provider(self) -> str:
        """Name of the serving software."""
        return "ollama"

    def request_body(self, messages: list[dict[str, Any]], *, stream: bool) -> dict[str, Any]:
        """Build the body of an /api/chat request; thinking is off to keep replies fast."""
        return {
            "model": self._model,
            "messages": messages,
            "stream": stream,
            "think": False,
            "keep_alive": self._keep_alive,
            "options": self._options,
        }

    def chat(
        self,
        *,
        chat_ctx: llm.ChatContext,
        tools: list[llm.Tool] | None = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
        parallel_tool_calls: NotGivenOr[bool] = NOT_GIVEN,
        tool_choice: NotGivenOr[llm.ToolChoice] = NOT_GIVEN,
        extra_kwargs: NotGivenOr[dict[str, Any]] = NOT_GIVEN,
    ) -> "OllamaStream":
        """Start a streamed answer; the arguments follow llm.LLM.chat."""
        return OllamaStream(self, chat_ctx=chat_ctx, tools=tools or [], conn_options=conn_options)

    async def complete(self, messages: list[dict[str, Any]], *, timeout_seconds: float) -> str:
        """Return a whole answer at once, for work outside the conversation.

        Raises:
            ModelError: If Ollama cannot be reached or answers with an error.
        """
        try:
            response = await self._http.post(
                "/api/chat", json=self.request_body(messages, stream=False), timeout=timeout_seconds
            )
            response.raise_for_status()
            return str(response.json()["message"]["content"]).strip()
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as error:
            raise ModelError(f"Ollama could not answer: {error}") from error

    def open_stream(self, body: dict[str, Any], timeout_seconds: float) -> Any:
        """Open a streaming /api/chat request; used by OllamaStream."""
        return self._http.stream("POST", "/api/chat", json=body, timeout=timeout_seconds)

    async def aclose(self) -> None:
        """Close the connection pool."""
        await self._http.aclose()


class OllamaStream(llm.LLMStream):
    """One streamed answer from Ollama."""

    def __init__(
        self,
        model: OllamaLLM,
        *,
        chat_ctx: llm.ChatContext,
        tools: list[llm.Tool],
        conn_options: APIConnectOptions,
    ) -> None:
        """Prepare the stream; LiveKit starts _run and retries it on transient errors."""
        super().__init__(model, chat_ctx=chat_ctx, tools=tools, conn_options=conn_options)
        self._model = model

    async def _run(self) -> None:
        body = self._model.request_body(to_ollama_messages(self._chat_ctx), stream=True)
        if self._tools:
            body["tools"] = to_ollama_tools(self._tools)
        request_id = f"ollama_{uuid4().hex[:12]}"
        try:
            async with self._model.open_stream(body, self._conn_options.timeout) as response:
                await _raise_for_status(response)
                async for chunk in _chunks(response.aiter_lines(), request_id):
                    self._event_ch.send_nowait(chunk)
        except httpx.TimeoutException as error:
            raise APITimeoutError() from error
        except httpx.TransportError as error:
            raise APIConnectionError() from error


async def _raise_for_status(response: httpx.Response) -> None:
    if response.is_error:
        await response.aread()
        raise APIStatusError(
            f"Ollama answered {response.status_code}: {response.text[:200]}",
            status_code=response.status_code,
        )


async def _chunks(lines: AsyncIterator[str], request_id: str) -> AsyncIterator[llm.ChatChunk]:
    async for line in lines:
        if line.strip():
            chunk = _chunk_from_line(line, request_id)
            if chunk is not None:
                yield chunk


async def summarize(model: OllamaLLM, transcript: str, *, timeout_seconds: float = 30.0) -> str:
    """Summarise a finished call in at most three German sentences.

    Args:
        model: The Ollama plugin.
        transcript: Transcript as plain text, one turn per line.
        timeout_seconds: Upper bound for the model's answer.

    Returns:
        The summary; a fixed sentence when nobody spoke.

    Raises:
        ModelError: If the model cannot answer.
    """
    if not transcript.strip():
        return EMPTY_CALL_SUMMARY
    messages = [
        {"role": "system", "content": SUMMARY_INSTRUCTIONS},
        {"role": "user", "content": transcript},
    ]
    return await model.complete(messages, timeout_seconds=timeout_seconds)
