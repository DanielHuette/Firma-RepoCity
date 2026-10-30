"""Tests of the Ollama language model plugin."""

import json

import httpx
import pytest
from livekit.agents import APIConnectionError, APIStatusError, llm
from livekit.agents.types import APIConnectOptions

from repocity_telefon.ollama import OllamaLLM, summarize, to_ollama_messages, to_ollama_tools

NO_RETRY = APIConnectOptions(max_retry=0, retry_interval=0, timeout=5)


@llm.function_tool
async def request_callback(name: str, topic: str) -> str:
    """Ask Daniel to call back.

    Args:
        name: Name of the caller.
        topic: What the callback is about.
    """
    return "ok"


def ndjson(*lines: dict[str, object]) -> bytes:
    return b"".join(json.dumps(line).encode() + b"\n" for line in lines)


def conversation() -> llm.ChatContext:
    chat = llm.ChatContext()
    chat.add_message(role="system", content="Sei freundlich.")
    chat.add_message(role="user", content="Bitte Rückruf.")
    chat.insert(
        llm.FunctionCall(call_id="call_1", name="request_callback", arguments='{"name": "Erika"}')
    )
    chat.insert(
        llm.FunctionCallOutput(
            call_id="call_1", name="request_callback", output="notiert", is_error=False
        )
    )
    chat.add_message(role="assistant", content="Erledigt.")
    return chat


def test_messages_use_ollama_shape() -> None:
    assert to_ollama_messages(conversation()) == [
        {"role": "system", "content": "Sei freundlich."},
        {"role": "user", "content": "Bitte Rückruf."},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {"function": {"name": "request_callback", "arguments": {"name": "Erika"}}}
            ],
        },
        {"role": "tool", "content": "notiert", "tool_name": "request_callback"},
        {"role": "assistant", "content": "Erledigt."},
    ]


def test_tool_schema_carries_names_and_descriptions() -> None:
    (schema,) = to_ollama_tools([request_callback])
    function = schema["function"]
    assert schema["type"] == "function"
    assert function["name"] == "request_callback"
    assert function["parameters"]["properties"]["topic"]["description"] == (
        "What the callback is about."
    )


def model_with(handler: httpx.MockTransport) -> OllamaLLM:
    return OllamaLLM(base_url="http://ollama:11434", model="qwen3:8b", transport=handler)


async def test_stream_yields_text_tool_calls_and_usage() -> None:
    sent: list[dict[str, object]] = []

    def answer(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        body = ndjson(
            {"message": {"role": "assistant", "content": "Gern"}, "done": False},
            {
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {"function": {"name": "request_callback", "arguments": {"name": "Erika"}}}
                    ],
                },
                "done": False,
            },
            {
                "message": {"role": "assistant", "content": ""},
                "done": True,
                "prompt_eval_count": 120,
                "eval_count": 8,
            },
        )
        return httpx.Response(200, content=body)

    model = model_with(httpx.MockTransport(answer))
    stream = model.chat(chat_ctx=conversation(), tools=[request_callback], conn_options=NO_RETRY)
    chunks = [chunk async for chunk in stream]
    await model.aclose()

    text = "".join(c.delta.content or "" for c in chunks if c.delta)
    calls = [call for c in chunks if c.delta for call in c.delta.tool_calls]
    usage = [c.usage for c in chunks if c.usage]
    assert text == "Gern"
    assert [(call.name, json.loads(call.arguments)) for call in calls] == [
        ("request_callback", {"name": "Erika"})
    ]
    assert calls[0].call_id
    assert usage[0] is not None and usage[0].total_tokens == 128
    request = sent[0]
    assert request["model"] == "qwen3:8b"
    assert request["stream"] is True
    assert request["think"] is False
    assert isinstance(request["tools"], list) and len(request["tools"]) == 1


async def test_server_error_becomes_status_error() -> None:
    model = model_with(httpx.MockTransport(lambda _r: httpx.Response(500, text="boom")))
    with pytest.raises(APIStatusError):
        stream = model.chat(chat_ctx=conversation(), conn_options=NO_RETRY)
        async for _chunk in stream:
            pass
    await model.aclose()


async def test_error_line_in_stream_becomes_status_error() -> None:
    body = ndjson({"error": "model 'qwen3:8b' not found"})
    model = model_with(httpx.MockTransport(lambda _r: httpx.Response(200, content=body)))
    with pytest.raises(APIStatusError, match="not found"):
        stream = model.chat(chat_ctx=conversation(), conn_options=NO_RETRY)
        async for _chunk in stream:
            pass
    await model.aclose()


async def test_unreachable_server_becomes_connection_error() -> None:
    def refuse(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    model = model_with(httpx.MockTransport(refuse))
    with pytest.raises(APIConnectionError):
        stream = model.chat(chat_ctx=conversation(), conn_options=NO_RETRY)
        async for _chunk in stream:
            pass
    await model.aclose()


async def test_summarize_returns_model_text() -> None:
    sent: list[dict[str, object]] = []

    def answer(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={"message": {"role": "assistant", "content": " Rückruf. "}})

    model = model_with(httpx.MockTransport(answer))
    summary = await summarize(model, "Anrufer: Bitte Rückruf.")
    await model.aclose()
    assert summary == "Rückruf."
    assert sent[0]["stream"] is False
    messages = sent[0]["messages"]
    assert isinstance(messages, list)
    assert "Anrufer: Bitte Rückruf." in messages[-1]["content"]


async def test_summarize_of_empty_transcript_needs_no_model() -> None:
    model = model_with(httpx.MockTransport(lambda _r: httpx.Response(500)))
    assert await summarize(model, "") == "Der Anrufer hat nichts gesagt."
    await model.aclose()
