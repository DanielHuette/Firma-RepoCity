"""Tests of the call lifecycle around the agent: facts, time limit and the final record."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import httpx
import pytest
from livekit.agents import AgentSession, inference
from livekit.plugins import silero

from repocity_telefon import worker
from repocity_telefon.agent import TelefonAgent
from repocity_telefon.call_log import CallLog
from repocity_telefon.call_tools import CallTools
from repocity_telefon.crm import CrmClient
from repocity_telefon.errors import ModelError
from repocity_telefon.facts import BusinessFacts
from repocity_telefon.settings import AgentSettings, load
from repocity_telefon.speech_plugins import SpeechClient
from repocity_telefon.worker import (
    SUMMARY_TIMEOUT_SECONDS,
    TIME_UP,
    CallEnd,
    CallServices,
    build_server,
    build_session,
    call_end_seconds,
    finish_call,
    read_facts,
    say_time_up,
)

from .conftest import ScriptedPostgrest
from .fake_llm import FakeLLM
from .test_settings import AGENT_ENV

CALL_ID = "44444444-4444-4444-8444-444444444444"
STARTED = datetime(2026, 10, 25, 9, 0, tzinfo=UTC)


@pytest.fixture
def log() -> CallLog:
    call = CallLog(caller_number="+492511234567", started_at=STARTED)
    call.add("assistant", "Guten Tag.")
    call.add("caller", "Ich möchte einen Rückruf.")
    return call


async def test_facts_are_read_from_the_crm(crm: CrmClient, postgrest: ScriptedPostgrest) -> None:
    postgrest.reply(
        200, [{"assistant_greeting": "Hallo", "assistant_facts": "", "small_business": True}]
    )
    postgrest.reply(200, [])
    assert (await read_facts(crm)).greeting == "Hallo"


async def test_unreadable_facts_leave_the_assistant_without_facts(
    crm: CrmClient, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(400, {"message": "permission denied"})
    assert await read_facts(crm) == BusinessFacts.unavailable()


async def test_finished_call_is_summarised_and_recorded(
    crm: CrmClient, postgrest: ScriptedPostgrest, log: CallLog
) -> None:
    seen: list[str] = []

    async def summarise(transcript: str) -> str:
        seen.append(transcript)
        return "Erika möchte einen Rückruf."

    postgrest.reply(200, CALL_ID)
    ended = STARTED + timedelta(minutes=2)
    assert await finish_call(log, crm, summarise, ended_at=ended) == UUID(CALL_ID)
    assert seen == ["Assistentin: Guten Tag.\nAnrufer: Ich möchte einen Rückruf."]
    payload = postgrest.body(0)["p_call"]  # type: ignore[index]
    assert payload["summary"] == "Erika möchte einen Rückruf."
    assert payload["ended_at"] == ended.isoformat()
    assert payload["outcome"] == "info"


async def test_call_is_recorded_without_summary_when_the_model_fails(
    crm: CrmClient, postgrest: ScriptedPostgrest, log: CallLog
) -> None:
    async def broken(_transcript: str) -> str:
        raise ModelError("Ollama down")

    postgrest.reply(200, CALL_ID)
    await finish_call(log, crm, broken, ended_at=STARTED)
    assert postgrest.body(0)["p_call"]["summary"] == ""  # type: ignore[index]


async def test_unrecorded_call_does_not_raise(
    crm: CrmClient, postgrest: ScriptedPostgrest, log: CallLog
) -> None:
    async def summarise(_transcript: str) -> str:
        return ""

    postgrest.reply(400, {"message": "Anruf passt nicht zum erwarteten Aufbau."})
    assert await finish_call(log, crm, summarise, ended_at=STARTED) is None


async def test_time_limit_says_goodbye_and_hangs_up(crm: CrmClient, log: CallLog) -> None:
    hung_up: list[bool] = []

    async def hang_up() -> None:
        hung_up.append(True)

    agent = TelefonAgent(BusinessFacts.unavailable(), CallTools(crm, log))
    async with AgentSession(llm=FakeLLM()) as session:
        await session.start(agent)
        await say_time_up(session, hang_up)
        spoken = [item.text_content for item in session.history.messages()]
    assert spoken[-1] == TIME_UP
    assert hung_up == [True]


async def test_voice_pipeline_runs_only_on_local_models() -> None:
    health = {"status": "ok", "whisper_model": "small", "voice": "v", "sample_rate": 16000}
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json=health))
    speech = SpeechClient("http://speech.test", timeout_seconds=5, transport=transport)
    services = CallServices(crm=None, speech=speech, model=FakeLLM())  # type: ignore[arg-type]
    session = await build_session(services, silero.VAD.load())
    assert session.interruption_detection == "vad"
    detector = session.turn_detection
    assert isinstance(detector, inference.TurnDetector)
    assert detector.model == "turn-detector-v1-mini"
    assert session.tts is not None and session.tts.sample_rate == 16000


async def test_call_that_failed_before_the_voice_started_is_still_recorded(
    crm: CrmClient, postgrest: ScriptedPostgrest, log: CallLog
) -> None:
    closed: list[str] = []

    async def summarise(_transcript: str) -> str:
        return ""

    postgrest.reply(200, CALL_ID)
    end = CallEnd(log, crm, summarise, close=lambda: _note(closed))
    await end()
    assert postgrest.body(0)["p_call"]["outcome"] == "info"  # type: ignore[index]
    assert closed == ["closed"]


async def _note(closed: list[str]) -> None:
    closed.append("closed")


class _RecordingServer:
    options: dict[str, object] = {}

    def __init__(self, **options: object) -> None:
        _RecordingServer.options = options

    def rtc_session(self, *_args: object, **_kwargs: object) -> None:
        return None


def test_call_end_time_covers_the_summary_and_every_crm_try(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name, value in AGENT_ENV.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("CRM_TIMEOUT_SECONDS", "20")
    settings = load(AgentSettings)
    assert call_end_seconds(settings) > SUMMARY_TIMEOUT_SECONDS + 3 * 20


def test_job_process_is_not_killed_while_the_call_is_stored(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name, value in AGENT_ENV.items():
        monkeypatch.setenv(name, value)
    settings = load(AgentSettings)
    monkeypatch.setattr(worker, "AgentServer", _RecordingServer)
    build_server(settings)
    timeout = _RecordingServer.options["shutdown_process_timeout"]
    assert isinstance(timeout, float)
    assert timeout >= call_end_seconds(settings)
