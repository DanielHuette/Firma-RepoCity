"""Behaviour tests of the phone assistant with LiveKit's run helpers and a scripted model."""

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from livekit.agents import AgentSession
from livekit.agents.voice.run_result import RunResult

from repocity_telefon.agent import TelefonAgent, caller_number
from repocity_telefon.call_log import CallLog
from repocity_telefon.call_tools import CallTools
from repocity_telefon.crm import CrmClient
from repocity_telefon.facts import DEFAULT_GREETING, BusinessFacts, Product

from .conftest import ScriptedPostgrest
from .fake_llm import FakeLLM, Reply, ToolCall

CALLER = "+492511234567"
CUSTOMER_ID = "22222222-2222-4222-8222-222222222222"
FACTS = BusinessFacts(
    greeting="",
    facts="Daniel arbeitet von Münster aus.",
    small_business=True,
    products=(Product("Webseiten-Prüfung", "", Decimal("249"), Decimal("19"), "once"),),
)


@pytest.fixture
def log() -> CallLog:
    return CallLog(caller_number=CALLER, started_at=datetime(2026, 10, 25, 9, 0, tzinfo=UTC))


@pytest.fixture
def agent(crm: CrmClient, log: CallLog) -> TelefonAgent:
    return TelefonAgent(FACTS, CallTools(crm, log))


def test_caller_number_comes_from_the_sip_attributes() -> None:
    assert caller_number({"sip.phoneNumber": "+49251123", "sip.trunkPhoneNumber": "+49"}) == (
        "+49251123"
    )
    assert caller_number({}) == ""


@pytest.mark.parametrize("reported", ["anonymous", "Anonymous", "unknown", "  "])
def test_hidden_number_counts_as_suppressed(reported: str) -> None:
    assert caller_number({"sip.phoneNumber": reported}) == ""


def test_overlong_caller_number_is_cut_to_what_the_crm_stores() -> None:
    reported = "4925112345678" * 6
    assert caller_number({"sip.phoneNumber": reported}) == reported[:60]


async def test_greeting_discloses_the_ai_before_anything_else(agent: TelefonAgent) -> None:
    async with AgentSession(llm=FakeLLM()) as session:
        result = await session.start(agent, capture_run=True)
        result.expect.skip_next_event_if(type="agent_handoff")
        greeting = result.expect.next_event().is_message(role="assistant")
        assert greeting.event().item.text_content == DEFAULT_GREETING
        assert "digitale Assistentin" in DEFAULT_GREETING


async def test_model_sees_only_the_crm_facts(agent: TelefonAgent) -> None:
    model = FakeLLM(Reply(text="Die Prüfung kostet 249 Euro einmalig."))
    async with AgentSession(llm=model) as session:
        await session.start(agent)
        await session.run(user_input="Was kostet die Prüfung?")
    instructions = model.script.seen[0].messages()[0].text_content or ""
    assert "Daniel arbeitet von Münster aus." in instructions
    assert "249 Euro einmalig" in instructions


async def test_request_is_taken_through_the_crm(
    agent: TelefonAgent, log: CallLog, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, CUSTOMER_ID)
    arguments = {
        "name": "Erika Muster",
        "company": "",
        "email": "",
        "subject": "Webseite",
        "message": "Bitte um ein Angebot.",
    }
    model = FakeLLM(
        Reply(tool_calls=(ToolCall("take_request", arguments),)),
        Reply(text="Vielen Dank, Daniel meldet sich."),
    )
    async with AgentSession(llm=model) as session:
        await session.start(agent)
        result: RunResult[None] = await session.run(user_input="Ich hätte gern ein Angebot.")
    result.expect.next_event().is_function_call(name="take_request")
    output = result.expect.next_event().is_function_call_output()
    assert "aufgenommen" in output.event().item.output
    result.expect.next_event().is_message(role="assistant")
    assert postgrest.body(0)["p_message"] == "Bitte um ein Angebot."  # type: ignore[index]
    assert log.outcome == "inquiry"


async def test_quote_sentence_is_read_word_for_word(
    agent: TelefonAgent, log: CallLog, postgrest: ScriptedPostgrest
) -> None:
    sentence = "Vielen Dank. Ich habe Ihre Annahme des Angebots AN-2026-0004 eingetragen."
    postgrest.reply(200, {"done": True, "text": sentence})
    arguments = {"quote_number": "AN-2026-0004", "intent": "accept", "summary": "Nimmt an"}
    model = FakeLLM(Reply(tool_calls=(ToolCall("decide_quote", arguments),)))
    async with AgentSession(llm=model) as session:
        await session.start(agent)
        result: RunResult[None] = await session.run(
            user_input="Ich nehme das Angebot AN-2026-0004 an."
        )
    result.expect.next_event().is_function_call(name="decide_quote")
    result.expect.next_event().is_function_call_output()
    spoken = result.expect.next_event().is_message(role="assistant")
    assert spoken.event().item.text_content == sentence
    assert model.script.replies == []
    assert log.outcome == "quote_accepted"


async def test_callback_wish_is_booked_through_the_crm(
    agent: TelefonAgent, log: CallLog, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, "33333333-3333-4333-8333-333333333333")
    arguments = {"reason": "Rechnung", "wished_time": "2026-11-02T10:00:00+01:00"}
    model = FakeLLM(
        Reply(tool_calls=(ToolCall("request_callback", arguments),)),
        Reply(text="Daniel ruft Sie am Montag um 10 Uhr zurück, wenn es passt."),
    )
    async with AgentSession(llm=model) as session:
        await session.start(agent)
        result: RunResult[None] = await session.run(
            user_input="Bitte rufen Sie mich am Montag um 10 Uhr zurück."
        )
    result.expect.contains_function_call(name="request_callback")
    assert postgrest.body(0)["p_wished_at"] == "2026-11-02T10:00:00+01:00"  # type: ignore[index]
    assert log.outcome == "callback"


async def test_callback_wish_without_time_is_booked_too(
    agent: TelefonAgent, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, "33333333-3333-4333-8333-333333333333")
    model = FakeLLM(
        Reply(tool_calls=(ToolCall("request_callback", {"reason": "Rechnung"}),)),
        Reply(text="Daniel ruft Sie so bald wie möglich zurück."),
    )
    async with AgentSession(llm=model) as session:
        await session.start(agent)
        await session.run(user_input="Bitte rufen Sie mich zurück.")
    assert postgrest.body(0)["p_wished_at"] is None  # type: ignore[index]


async def test_the_channel_the_caller_named_is_handed_on(
    agent: TelefonAgent, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, CUSTOMER_ID)
    arguments = {
        "name": "Erika Muster",
        "company": "",
        "subject": "Webseite",
        "message": "Bitte um ein Angebot.",
        "channel": "referral",
    }
    model = FakeLLM(
        Reply(tool_calls=(ToolCall("take_request", arguments),)),
        Reply(text="Vielen Dank, Daniel meldet sich."),
    )
    async with AgentSession(llm=model) as session:
        await session.start(agent)
        await session.run(user_input="Ein Bekannter hat Sie empfohlen.")
    assert postgrest.body(0)["p_channel"] == "referral"  # type: ignore[index]


async def test_the_model_knows_today_and_asks_how_the_caller_found_us(
    crm: CrmClient, log: CallLog
) -> None:
    friday = datetime(2026, 10, 30, 13, 5, tzinfo=UTC)
    model = FakeLLM(Reply(text="Guten Tag."))
    async with AgentSession(llm=model) as session:
        await session.start(TelefonAgent(FACTS, CallTools(crm, log), now=friday))
        await session.run(user_input="Hallo")
    instructions = model.script.seen[0].messages()[0].text_content or ""
    assert "Jetzt ist Freitag, 30. Oktober 2026, 14:05 Uhr" in instructions
    assert "Wie sind Sie auf uns aufmerksam geworden?" in instructions
