"""Tests of what the assistant's tools do in the CRM and what they report back."""

import asyncio
from datetime import UTC, datetime
from uuid import UUID

import httpx
import pytest

from repocity_telefon.call_log import CallLog
from repocity_telefon.call_tools import CallTools, quote_key
from repocity_telefon.crm import CrmClient

from .conftest import SERVICE_KEY, SUPABASE_URL, ScriptedPostgrest

CALLER = "+492511234567"
CUSTOMER_ID = "22222222-2222-4222-8222-222222222222"
STARTED = datetime(2026, 10, 25, 9, 30, tzinfo=UTC)


@pytest.fixture
def log() -> CallLog:
    return CallLog(caller_number=CALLER, started_at=STARTED)


@pytest.fixture
def tools(crm: CrmClient, log: CallLog) -> CallTools:
    return CallTools(crm, log)


async def test_known_caller_is_named_and_linked(
    tools: CallTools, log: CallLog, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, CUSTOMER_ID)
    postgrest.reply(200, [{"name": "Muster GmbH", "contact_person": "Erika Muster"}])
    answer = await tools.look_up_caller()
    assert "Muster GmbH" in answer
    assert "Erika Muster" in answer
    assert log.customer_id == UUID(CUSTOMER_ID)


async def test_unknown_caller(tools: CallTools, log: CallLog, postgrest: ScriptedPostgrest) -> None:
    postgrest.reply(200, None)
    assert "keinem Kunden" in await tools.look_up_caller()
    assert log.customer_id is None


async def test_suppressed_number_is_not_looked_up(
    crm: CrmClient, postgrest: ScriptedPostgrest
) -> None:
    tools = CallTools(crm, CallLog(caller_number="", started_at=STARTED))
    assert "unterdrückt" in await tools.look_up_caller()
    assert postgrest.requests == []


async def test_lookup_reports_an_unreachable_crm(
    tools: CallTools, postgrest: ScriptedPostgrest
) -> None:
    for _ in range(3):
        postgrest.fail(httpx.ConnectError("refused"))
    assert "nicht erreichbar" in await tools.look_up_caller()


async def test_request_is_filed_once_with_contract_arguments(
    tools: CallTools, log: CallLog, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, CUSTOMER_ID)
    answer = await tools.take_request("Erika Muster", "", "", "Webseite", "Bitte Angebot.")
    assert "aufgenommen" in answer
    assert postgrest.body(0) == {
        "p_caller_number": CALLER,
        "p_name": "Erika Muster",
        "p_company": "",
        "p_email": None,
        "p_subject": "Webseite",
        "p_message": "Bitte Angebot.",
        "p_channel": "",
    }
    assert log.customer_id == UUID(CUSTOMER_ID)
    assert log.outcome == "inquiry"
    second = await tools.take_request("Erika Muster", "", "", "Nochmal", "Text")
    assert "bereits" in second
    assert len(postgrest.requests) == 1


async def test_request_failure_is_reported_and_never_repeated(
    tools: CallTools, log: CallLog, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(400, {"message": "kaputt"})
    answer = await tools.take_request("Erika", "", "erika@example.test", "Frage", "Text")
    assert "Gesprächsprotokoll" in answer
    assert log.outcome == "inquiry"
    await tools.take_request("Erika", "", "", "Frage", "Text")
    assert len(postgrest.requests) == 1


async def test_accepted_quote_returns_the_crm_sentence(
    tools: CallTools, log: CallLog, postgrest: ScriptedPostgrest
) -> None:
    sentence = "Vielen Dank. Ich habe Ihre Annahme des Angebots AN-2026-0004 eingetragen."
    postgrest.reply(200, {"done": True, "text": sentence})
    assert await tools.decide_quote("AN-2026-0004", "accept", "Nimmt an") == sentence
    assert postgrest.body(0) == {
        "p_caller_number": CALLER,
        "p_quote_number": "AN-2026-0004",
        "p_intent": "accept",
        "p_summary": "Nimmt an",
    }
    assert log.outcome == "quote_accepted"


async def test_declined_quote_marks_the_outcome(
    tools: CallTools, log: CallLog, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, {"done": True, "text": "Absage eingetragen."})
    await tools.decide_quote("AN-2026-0004", "decline", "")
    assert log.outcome == "quote_declined"


async def test_undecided_quote_becomes_a_callback(
    tools: CallTools, log: CallLog, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, {"done": False, "text": "Ich gebe sie zur persönlichen Prüfung weiter."})
    assert "Prüfung" in await tools.decide_quote("AN-9", "accept", "")
    assert log.outcome == "callback"


async def test_same_decision_is_sent_once(tools: CallTools, postgrest: ScriptedPostgrest) -> None:
    postgrest.reply(200, {"done": True, "text": "Eingetragen."})
    first = await tools.decide_quote("AN-2026-0004", "accept", "")
    again = await tools.decide_quote(" an-2026-0004 ", "accept", "")
    assert first == again == "Eingetragen."
    assert len(postgrest.requests) == 1


async def test_same_decision_in_another_spelling_is_sent_once(
    tools: CallTools, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, {"done": True, "text": "Eingetragen."})
    await tools.decide_quote("AN-2026-0004", "accept", "")
    assert await tools.decide_quote("an 2026 4", "accept", "") == "Eingetragen."
    assert len(postgrest.requests) == 1


async def test_simultaneous_same_decisions_are_sent_once(log: CallLog) -> None:
    received: list[httpx.Request] = []

    async def slow_postgrest(request: httpx.Request) -> httpx.Response:
        received.append(request)
        await asyncio.sleep(0.01)
        return httpx.Response(200, json={"done": True, "text": "Eingetragen."})

    transport = httpx.MockTransport(slow_postgrest)
    async with CrmClient(SUPABASE_URL, SERVICE_KEY, transport=transport) as crm:
        tools = CallTools(crm, log)
        answers = await asyncio.gather(
            tools.decide_quote("AN-2026-0004", "accept", ""),
            tools.decide_quote("AN-2026-0004", "accept", ""),
        )
    assert list(answers) == ["Eingetragen.", "Eingetragen."]
    assert len(received) == 1


@pytest.mark.parametrize(
    ("spoken", "key"),
    [
        ("AN-2026-0004", "AN2026-4"),
        ("an 2026 0004", "AN2026-4"),
        ("AN/2026/4", "AN2026-4"),
        ("2026-10", "2026-10"),
        ("", ""),
        ("Angebot vom Montag", "ANGEBOTVOMMONTAG"),
    ],
)
def test_quote_numbers_are_compared_like_the_crm_does(spoken: str, key: str) -> None:
    assert quote_key(spoken) == key


async def test_failed_decision_is_handed_to_daniel(
    tools: CallTools, log: CallLog, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(400, {"message": "kaputt"})
    answer = await tools.decide_quote("AN-1", "decline", "")
    assert "persönlich" in answer
    assert log.outcome == "callback"


APPOINTMENT_ID = "33333333-3333-4333-8333-333333333333"


@pytest.mark.parametrize(
    ("picked", "sent"),
    [("referral", "referral"), ("google_maps", "google_maps"), ("Zeitung", "other"), ("", "")],
)
async def test_the_channel_the_caller_named_reaches_the_crm(
    tools: CallTools, postgrest: ScriptedPostgrest, picked: str, sent: str
) -> None:
    postgrest.reply(200, CUSTOMER_ID)

    await tools.take_request("Erika Muster", "", "", "Webseite", "Bitte Angebot.", picked)

    assert postgrest.body(0)["p_channel"] == sent  # type: ignore[index]


async def test_a_callback_at_a_wished_time_is_booked_and_repeated(
    tools: CallTools, log: CallLog, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, APPOINTMENT_ID)

    answer = await tools.request_callback("Frage zur Rechnung", "2026-11-02T10:00:00+01:00")

    assert postgrest.requests[0].url.path == "/rest/v1/rpc/callback_from_call"
    assert postgrest.body(0) == {
        "p_caller_number": CALLER,
        "p_name": "",
        "p_reason": "Frage zur Rechnung",
        "p_wished_at": "2026-11-02T10:00:00+01:00",
    }
    assert answer == (
        "Der Rückrufwunsch ist notiert für Montag, 2. November 2026, 10:00 Uhr. Daniel ruft zu "
        "dieser Zeit zurück, wenn sie passt, sonst so bald wie möglich."
    )
    assert log.outcome == "callback"


async def test_a_wished_time_is_repeated_in_german_time(
    tools: CallTools, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, APPOINTMENT_ID)

    answer = await tools.request_callback("Rückfrage", "2026-11-02T09:00:00Z")

    assert "Montag, 2. November 2026, 10:00 Uhr" in answer
    assert postgrest.body(0)["p_wished_at"] == "2026-11-02T09:00:00+00:00"  # type: ignore[index]


async def test_a_callback_without_time_is_as_soon_as_possible(
    tools: CallTools, log: CallLog, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, APPOINTMENT_ID)

    answer = await tools.request_callback("Rückfrage", "")

    assert postgrest.body(0)["p_wished_at"] is None  # type: ignore[index]
    assert answer == "Der Rückrufwunsch ist notiert. Daniel ruft so bald wie möglich zurück."
    assert log.outcome == "callback"


@pytest.mark.parametrize("wished", ["morgen um zehn", "2026-11-02T10:00:00", "2026-11-02"])
async def test_a_wished_time_without_offset_is_asked_for_again(
    tools: CallTools, postgrest: ScriptedPostgrest, wished: str
) -> None:
    answer = await tools.request_callback("Rückfrage", wished)

    assert postgrest.requests == []
    assert "2026-11-02T10:00:00+01:00" in answer
    assert "noch einmal" in answer


async def test_the_name_the_caller_gave_goes_with_the_callback(
    tools: CallTools, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, CUSTOMER_ID)
    postgrest.reply(200, APPOINTMENT_ID)
    await tools.take_request("Erika Muster", "Muster GmbH", "", "Webseite", "Angebot", "")

    await tools.request_callback("Angebot besprechen", "")

    assert postgrest.body(1)["p_name"] == "Erika Muster"  # type: ignore[index]


async def test_a_callback_is_booked_once_per_call(
    tools: CallTools, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, APPOINTMENT_ID)
    await tools.request_callback("Rückfrage", "")

    again = await tools.request_callback("Rückfrage", "2026-11-02T10:00:00+01:00")

    assert "bereits notiert" in again
    assert len(postgrest.requests) == 1


async def test_a_callback_the_crm_did_not_take_stays_in_the_transcript(
    tools: CallTools, log: CallLog, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(400, {"message": "kaputt"})

    answer = await tools.request_callback("Rückfrage", "")

    assert "Gesprächsprotokoll" in answer
    assert "so bald wie möglich" in answer
    assert log.outcome == "callback"
    assert "bereits" in await tools.request_callback("Rückfrage", "")
    assert len(postgrest.requests) == 1
