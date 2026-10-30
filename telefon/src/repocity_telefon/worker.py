"""Worker that answers inbound SIP calls: voice pipeline, call limit and the final call record.

Context: runs as the `agent` container on the RepoCity server and registers with the local
LiveKit server under the agent name the SIP dispatch rule names. | Input: one LiveKit room per
call with the SIP caller in it. | Output: the conversation, CRM entries, one crm.record_call.

Usage:
    telefon-agent start
"""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import partial
from uuid import UUID

from livekit import rtc
from livekit.agents import (
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    cli,
    inference,
    room_io,
)
from livekit.agents.vad import VAD
from livekit.plugins import silero

from .agent import TelefonAgent, caller_number, record_turn
from .call_limit import CallLimit
from .call_log import CallLog
from .call_tools import CallTools
from .crm import CrmClient, longest_request_seconds
from .errors import ConfigurationError, CrmError, ModelError
from .facts import BusinessFacts
from .ollama import OllamaLLM, summarize
from .settings import AgentSettings, load
from .speech_plugins import LocalSTT, LocalTTS, SpeechClient

logger = logging.getLogger(__name__)

LANGUAGE = "de"
TIME_UP = (
    "Leider ist die Zeit für dieses Gespräch abgelaufen. Ihr Anliegen ist mitgeschrieben, "
    "Daniel meldet sich bei Bedarf. Auf Wiederhören."
)
SUMMARY_TIMEOUT_SECONDS = 30.0
_CALL_END_MARGIN_SECONDS = 15.0
Summariser = Callable[[str], Awaitable[str]]
_SIP = rtc.ParticipantKind.PARTICIPANT_KIND_SIP


def call_end_seconds(settings: AgentSettings) -> float:
    """Return how long a finished call may need to be summarised and stored with crm.record_call.

    Args:
        settings: Agent settings with the CRM timeout.

    Returns:
        Seconds the job process must be allowed to live after the call ended.
    """
    crm_seconds = longest_request_seconds(settings.crm_timeout_seconds)
    return SUMMARY_TIMEOUT_SECONDS + crm_seconds + _CALL_END_MARGIN_SECONDS


async def read_facts(crm: CrmClient) -> BusinessFacts:
    """Read what the assistant may say; without the CRM it knows nothing and only takes notes."""
    try:
        return await crm.load_facts()
    except CrmError:
        logger.exception("Business facts could not be read; the call runs without facts")
        return BusinessFacts.unavailable()


async def finish_call(
    log: CallLog, crm: CrmClient, summarise: Summariser, *, ended_at: datetime
) -> UUID | None:
    """Summarise the call and store it with crm.record_call.

    Args:
        log: Record of the finished call.
        crm: Open CRM client.
        summarise: Turns the transcript into a short German summary.
        ended_at: When the call ended.

    Returns:
        Id of the stored call, or None when the CRM refused or could not be reached.
    """
    try:
        summary = await summarise(log.transcript_text())
    except ModelError:
        logger.exception("Call summary failed; the call is stored without one")
        summary = ""
    try:
        return await crm.record_call(log.to_payload(ended_at=ended_at, summary=summary))
    except CrmError:
        logger.exception("Call record could not be stored")
        return None


async def say_time_up(session: AgentSession[None], hang_up: Callable[[], Awaitable[None]]) -> None:
    """End a call that reached its maximum length: stop talking, say goodbye, hang up."""
    session.interrupt(force=True)
    await session.say(TIME_UP, allow_interruptions=False)
    await hang_up()


@dataclass(frozen=True)
class CallServices:
    """Clients of CRM, speech service and language model for one call."""

    crm: CrmClient
    speech: SpeechClient
    model: OllamaLLM

    @classmethod
    def open(cls, settings: AgentSettings) -> "CallServices":
        """Create the clients from the settings."""
        crm = CrmClient(
            str(settings.supabase_url),
            settings.supabase_service_key.get_secret_value(),
            timeout_seconds=settings.crm_timeout_seconds,
        )
        speech = SpeechClient(
            str(settings.speech_url), timeout_seconds=settings.speech_timeout_seconds
        )
        model = OllamaLLM(base_url=str(settings.ollama_url), model=settings.ollama_model)
        return cls(crm, speech, model)

    async def close(self) -> None:
        """Close every connection pool."""
        await self.crm.aclose()
        await self.speech.aclose()
        await self.model.aclose()


async def build_session(services: CallServices, vad: VAD) -> AgentSession[None]:
    """Build the voice pipeline of one call from local models only."""
    health = await services.speech.health()
    return AgentSession(
        stt=LocalSTT(services.speech, language=LANGUAGE),
        vad=vad,
        llm=services.model,
        tts=LocalTTS(services.speech, sample_rate=health.sample_rate),
        turn_handling={
            "turn_detection": inference.TurnDetector(version="v1-mini"),
            "interruption": {"enabled": True, "mode": "vad"},
        },
    )


async def _hang_up(ctx: JobContext) -> None:
    await ctx.delete_room()
    ctx.shutdown(reason="call limit reached")


class CallEnd:
    """Runs once when the call's job shuts down, however far the call got."""

    def __init__(
        self,
        log: CallLog,
        crm: CrmClient,
        summarise: Summariser,
        close: Callable[[], Awaitable[None]],
    ) -> None:
        """Bind the record of the call and the clients to close afterwards."""
        self._log, self._crm, self._summarise, self._close = log, crm, summarise, close
        self.limit: CallLimit | None = None

    async def __call__(self) -> None:
        """Stop the time limit, store the call record, close the clients."""
        if self.limit is not None:
            self.limit.cancel()
        await finish_call(self._log, self._crm, self._summarise, ended_at=datetime.now(UTC))
        await self._close()


async def entrypoint(ctx: JobContext) -> None:
    """Answer one call from greeting to the stored call record."""
    settings: AgentSettings = ctx.proc.userdata["settings"]
    await ctx.connect()
    participant = await ctx.wait_for_participant(kind=_SIP)
    log = CallLog(caller_number=caller_number(participant.attributes), started_at=datetime.now(UTC))
    services = CallServices.open(settings)
    summarise = partial(summarize, services.model, timeout_seconds=SUMMARY_TIMEOUT_SECONDS)
    end = CallEnd(log, services.crm, summarise, services.close)
    ctx.add_shutdown_callback(end)
    session = await build_session(services, ctx.proc.userdata["vad"])
    session.on("conversation_item_added", partial(record_turn, log))
    end.limit = CallLimit(
        settings.max_call_minutes * 60, partial(say_time_up, session, partial(_hang_up, ctx))
    )
    agent = TelefonAgent(await read_facts(services.crm), CallTools(services.crm, log))
    options = room_io.RoomOptions(
        audio_input=room_io.AudioInputOptions(sample_rate=16000),
        participant_kinds=[_SIP],
        delete_room_on_close=True,
    )
    await session.start(agent, room=ctx.room, room_options=options, record=False)
    end.limit.start()


def prewarm(proc: JobProcess) -> None:
    """Load settings and the voice activity model once per worker process."""
    proc.userdata["settings"] = load(AgentSettings)
    proc.userdata["vad"] = silero.VAD.load()


def build_server(settings: AgentSettings) -> AgentServer:
    """Create the worker that the LiveKit server dispatches calls to."""
    server = AgentServer(
        setup_fnc=prewarm,
        ws_url=settings.livekit_url,
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret.get_secret_value(),
        host="127.0.0.1",
        port=settings.agent_health_port,
        num_idle_processes=settings.agent_idle_processes,
        # LiveKit ends the job as soon as the agent has left the room and kills the process
        # after this many seconds, while the call is still being summarised and stored.
        shutdown_process_timeout=call_end_seconds(settings),
    )
    server.rtc_session(entrypoint, agent_name=settings.agent_name)
    return server


def main() -> None:
    """Check the settings, then run the LiveKit worker command line (`start`)."""
    try:
        settings = load(AgentSettings)
    except ConfigurationError as error:
        raise SystemExit(f"telefon-agent: {error}") from error
    cli.run_app(build_server(settings))


if __name__ == "__main__":
    main()
