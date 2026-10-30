"""Tests of the CRM client against a scripted PostgREST."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import httpx
import pytest

from repocity_telefon.crm import (
    CrmClient,
    IntakeRequest,
    KnownCaller,
    QuoteDecision,
    longest_request_seconds,
)
from repocity_telefon.errors import CrmError, CrmUnavailableError
from repocity_telefon.facts import BusinessFacts, Product

from .conftest import SERVICE_KEY, ScriptedPostgrest

CUSTOMER_ID = "22222222-2222-4222-8222-222222222222"
OTHER_ID = "33333333-3333-4333-8333-333333333333"
SETTINGS_ROW = {"assistant_greeting": "Hallo", "assistant_facts": "Münster", "small_business": True}
PRODUCT_ROW = {
    "name": "Prüfung",
    "description": "Webseite",
    "price_net": 249.0,
    "vat_rate": 19,
    "billing": "once",
}


async def test_load_facts_reads_settings_and_active_products(
    crm: CrmClient, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, [SETTINGS_ROW])
    postgrest.reply(200, [PRODUCT_ROW])
    facts = await crm.load_facts()
    assert facts == BusinessFacts(
        greeting="Hallo",
        facts="Münster",
        small_business=True,
        products=(Product("Prüfung", "Webseite", Decimal("249.0"), Decimal("19"), "once"),),
    )
    settings_request, products_request = postgrest.requests
    assert settings_request.url.path == "/rest/v1/settings"
    assert settings_request.headers["Accept-Profile"] == "crm"
    assert settings_request.headers["apikey"] == SERVICE_KEY
    assert settings_request.headers["Authorization"] == f"Bearer {SERVICE_KEY}"
    assert products_request.url.params["active"] == "eq.true"


async def test_missing_settings_row_is_an_error(
    crm: CrmClient, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, [])
    with pytest.raises(CrmError, match="settings"):
        await crm.load_facts()


async def test_invalid_product_row_is_an_error(
    crm: CrmClient, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, [SETTINGS_ROW])
    postgrest.reply(200, [{**PRODUCT_ROW, "billing": "yearly"}])
    with pytest.raises(CrmError, match="unexpected"):
        await crm.load_facts()


async def test_find_customer_uses_the_database_number_rule(
    crm: CrmClient, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, CUSTOMER_ID)
    postgrest.reply(200, [{"name": "Muster GmbH", "contact_person": "Erika"}])
    caller = await crm.find_customer("+492511234567")
    assert caller == KnownCaller(UUID(CUSTOMER_ID), "Muster GmbH", "Erika")
    lookup, details = postgrest.requests
    assert lookup.url.path == "/rest/v1/rpc/customer_by_phone"
    assert postgrest.body(0) == {"p_number": "+492511234567"}
    assert details.url.params["id"] == f"eq.{CUSTOMER_ID}"
    assert details.headers["Accept-Profile"] == "crm"


async def test_find_customer_without_match(crm: CrmClient, postgrest: ScriptedPostgrest) -> None:
    postgrest.reply(200, None)
    assert await crm.find_customer("+492511234567") is None
    assert len(postgrest.requests) == 1


async def test_find_customer_with_suppressed_number_asks_nothing(
    crm: CrmClient, postgrest: ScriptedPostgrest
) -> None:
    assert await crm.find_customer("  ") is None
    assert postgrest.requests == []


async def test_intake_call_sends_contract_arguments(
    crm: CrmClient, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, CUSTOMER_ID)
    request = IntakeRequest(
        caller_number="+492511234567",
        name="Erika Muster",
        company="Muster GmbH",
        email=None,
        subject="Webseite",
        message="Möchte ein Angebot.",
    )
    assert await crm.intake_call(request) == UUID(CUSTOMER_ID)
    sent = postgrest.requests[0]
    assert sent.url.path == "/rest/v1/rpc/intake_call"
    assert sent.headers["Content-Profile"] == "crm"
    assert postgrest.body(0) == {
        "p_caller_number": "+492511234567",
        "p_name": "Erika Muster",
        "p_company": "Muster GmbH",
        "p_email": None,
        "p_subject": "Webseite",
        "p_message": "Möchte ein Angebot.",
        "p_channel": "",
    }


async def test_phone_quote_decision_returns_sentence(
    crm: CrmClient, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, {"done": True, "text": "Vielen Dank, das Angebot ist angenommen."})
    decision = await crm.phone_quote_decision("+492511234567", "AN-2026-0004", "accept", "nimmt an")
    assert decision == QuoteDecision(done=True, text="Vielen Dank, das Angebot ist angenommen.")
    assert postgrest.body(0) == {
        "p_caller_number": "+492511234567",
        "p_quote_number": "AN-2026-0004",
        "p_intent": "accept",
        "p_summary": "nimmt an",
    }


async def test_record_call_sends_payload(crm: CrmClient, postgrest: ScriptedPostgrest) -> None:
    postgrest.reply(200, OTHER_ID)
    payload: dict[str, object] = {"started_at": "2026-10-25T09:00:00+00:00", "outcome": "info"}
    assert await crm.record_call(payload) == UUID(OTHER_ID)
    assert postgrest.body(0) == {"p_call": payload}


async def test_database_error_message_is_kept(crm: CrmClient, postgrest: ScriptedPostgrest) -> None:
    postgrest.reply(400, {"code": "P0001", "message": "Angebot nicht gefunden"})
    with pytest.raises(CrmError, match="Angebot nicht gefunden") as caught:
        await crm.phone_quote_decision("+49251", "AN-1", "accept", "")
    assert not isinstance(caught.value, CrmUnavailableError)
    assert len(postgrest.requests) == 1


async def test_reads_are_retried_after_server_errors(
    crm: CrmClient, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(503, {"message": "busy"})
    postgrest.fail(httpx.ReadTimeout("slow"))
    postgrest.reply(200, None)
    assert await crm.find_customer("+492511234567") is None
    assert len(postgrest.requests) == 3


async def test_reads_give_up_after_attempts(crm: CrmClient, postgrest: ScriptedPostgrest) -> None:
    for _ in range(3):
        postgrest.reply(502, {"message": "bad gateway"})
    with pytest.raises(CrmUnavailableError):
        await crm.find_customer("+492511234567")
    assert len(postgrest.requests) == 3


async def test_write_is_not_repeated_after_read_timeout(
    crm: CrmClient, postgrest: ScriptedPostgrest
) -> None:
    postgrest.fail(httpx.ReadTimeout("slow"))
    request = IntakeRequest("+49251", "Erika", "", None, "Frage", "Text")
    with pytest.raises(CrmUnavailableError):
        await crm.intake_call(request)
    assert len(postgrest.requests) == 1


async def test_write_is_repeated_when_it_never_arrived(
    crm: CrmClient, postgrest: ScriptedPostgrest
) -> None:
    postgrest.fail(httpx.ConnectError("refused"))
    postgrest.reply(429, {"message": "slow down"})
    postgrest.reply(200, CUSTOMER_ID)
    request = IntakeRequest("+49251", "Erika", "", None, "Frage", "Text")
    assert await crm.intake_call(request) == UUID(CUSTOMER_ID)
    assert len(postgrest.requests) == 3


async def test_record_call_is_repeated_after_read_timeout(
    crm: CrmClient, postgrest: ScriptedPostgrest
) -> None:
    postgrest.fail(httpx.ReadTimeout("slow"))
    postgrest.reply(200, OTHER_ID)
    assert await crm.record_call({"outcome": "info"}) == UUID(OTHER_ID)
    assert len(postgrest.requests) == 2


async def test_unexpected_rpc_answer_is_an_error(
    crm: CrmClient, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, {"done": "maybe"})
    with pytest.raises(CrmError, match="unexpected"):
        await crm.phone_quote_decision("+49251", "AN-1", "decline", "")


def test_longest_request_counts_every_try_and_pause() -> None:
    assert longest_request_seconds(10.0) == 3 * (10.0 + 3.0) + 0.5 + 1.0
    assert longest_request_seconds(2.0, attempts=1) == 4.0


async def test_intake_call_hands_on_the_channel(
    crm: CrmClient, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, CUSTOMER_ID)
    request = IntakeRequest("+49251", "Erika", "", None, "Frage", "Text", "referral")

    await crm.intake_call(request)

    assert postgrest.body(0)["p_channel"] == "referral"  # type: ignore[index]


async def test_callback_from_call_sends_contract_arguments(
    crm: CrmClient, postgrest: ScriptedPostgrest
) -> None:
    appointment = "33333333-3333-4333-8333-333333333333"
    postgrest.reply(200, appointment)
    wished = datetime(2026, 11, 2, 10, 0, tzinfo=timezone(timedelta(hours=1)))

    answer = await crm.callback_from_call("+492511234567", "Erika Muster", "Angebot", wished)

    assert answer == UUID(appointment)
    assert postgrest.requests[0].url.path == "/rest/v1/rpc/callback_from_call"
    assert postgrest.requests[0].headers["Content-Profile"] == "crm"
    assert postgrest.body(0) == {
        "p_caller_number": "+492511234567",
        "p_name": "Erika Muster",
        "p_reason": "Angebot",
        "p_wished_at": "2026-11-02T10:00:00+01:00",
    }


async def test_callback_without_wished_time_sends_null(
    crm: CrmClient, postgrest: ScriptedPostgrest
) -> None:
    postgrest.reply(200, "33333333-3333-4333-8333-333333333333")

    await crm.callback_from_call("", "", "Rückfrage", None)

    assert postgrest.body(0)["p_wished_at"] is None  # type: ignore[index]


async def test_a_callback_is_not_sent_twice_after_the_crm_got_it(
    crm: CrmClient, postgrest: ScriptedPostgrest
) -> None:
    postgrest.fail(httpx.ReadTimeout("slow"))

    with pytest.raises(CrmUnavailableError):
        await crm.callback_from_call("+49251", "", "Rückfrage", None)
    assert len(postgrest.requests) == 1
