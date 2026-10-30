"""Tests of the call record sent to crm.record_call."""

from datetime import UTC, datetime
from uuid import UUID

from repocity_telefon.call_log import CallLog

CUSTOMER_ID = UUID("22222222-2222-4222-8222-222222222222")
STARTED = datetime(2026, 10, 25, 9, 0, tzinfo=UTC)
ENDED = datetime(2026, 10, 25, 9, 4, 30, tzinfo=UTC)


def new_log() -> CallLog:
    return CallLog(caller_number="+492511234567", started_at=STARTED)


def test_transcript_keeps_order_and_skips_blank_text() -> None:
    log = new_log()
    log.add("assistant", "Guten Tag.")
    log.add("caller", "   ")
    log.add("caller", " Ich hätte eine Frage. ")
    assert [(entry.speaker, entry.text) for entry in log.transcript] == [
        ("assistant", "Guten Tag."),
        ("caller", "Ich hätte eine Frage."),
    ]


def test_call_without_caller_speech_counts_as_dropped() -> None:
    log = new_log()
    log.add("assistant", "Guten Tag.")
    assert log.outcome == "dropped"


def test_call_with_caller_speech_and_no_action_is_info() -> None:
    log = new_log()
    log.add("caller", "Was kostet die Prüfung?")
    assert log.outcome == "info"


def test_quote_decision_outranks_inquiry_and_callback() -> None:
    log = new_log()
    log.mark("callback")
    log.mark("quote_accepted")
    log.mark("inquiry")
    assert log.outcome == "quote_accepted"


def test_inquiry_outranks_callback() -> None:
    log = new_log()
    log.mark("inquiry")
    log.mark("callback")
    assert log.outcome == "inquiry"


def test_payload_matches_record_call_shape() -> None:
    log = new_log()
    log.customer_id = CUSTOMER_ID
    log.add("assistant", "Guten Tag.")
    log.add("caller", "Ich nehme das Angebot an.")
    log.mark("quote_accepted")
    assert log.to_payload(ended_at=ENDED, summary="Angebot angenommen.") == {
        "customer_id": str(CUSTOMER_ID),
        "caller_number": "+492511234567",
        "started_at": "2026-10-25T09:00:00+00:00",
        "ended_at": "2026-10-25T09:04:30+00:00",
        "transcript": [
            {"speaker": "assistant", "text": "Guten Tag."},
            {"speaker": "caller", "text": "Ich nehme das Angebot an."},
        ],
        "summary": "Angebot angenommen.",
        "outcome": "quote_accepted",
    }


def test_payload_without_customer_sends_null() -> None:
    payload = new_log().to_payload(ended_at=ENDED, summary="")
    assert payload["customer_id"] is None


def test_transcript_text_for_summary() -> None:
    log = new_log()
    log.add("assistant", "Guten Tag.")
    log.add("caller", "Rufen Sie mich zurück.")
    assert log.transcript_text() == "Assistentin: Guten Tag.\nAnrufer: Rufen Sie mich zurück."


def test_payload_without_number_sends_null() -> None:
    log = CallLog(caller_number="  ", started_at=STARTED)
    assert log.to_payload(ended_at=ENDED, summary="")["caller_number"] is None


def test_payload_respects_database_limits() -> None:
    log = new_log()
    log.add("caller", "a" * 5000)
    for _ in range(2100):
        log.add("assistant", "Ja.")
    payload = log.to_payload(ended_at=ENDED, summary="b" * 2500)
    transcript = payload["transcript"]
    assert isinstance(transcript, list)
    assert len(transcript) == 2000
    assert len(transcript[0]["text"]) == 4000
    assert payload["summary"] == "b" * 2000
