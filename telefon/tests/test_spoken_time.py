"""Tests of how days and times are put into words for the caller and the model."""

from datetime import UTC, datetime, timedelta, timezone

from repocity_telefon.spoken_time import now_line, spoken_when


def test_a_time_is_said_in_german_time() -> None:
    assert spoken_when(datetime(2026, 11, 2, 9, 0, tzinfo=UTC)) == (
        "Montag, 2. November 2026, 10:00 Uhr"
    )
    summer = datetime(2027, 7, 1, 14, 30, tzinfo=timezone(timedelta(hours=2)))
    assert spoken_when(summer) == "Donnerstag, 1. Juli 2027, 14:30 Uhr"


def test_the_instructions_know_the_day_the_time_and_the_offset() -> None:
    assert now_line(datetime(2026, 10, 30, 13, 5, tzinfo=UTC)) == (
        "Jetzt ist Freitag, 30. Oktober 2026, 14:05 Uhr deutscher Zeit (Versatz zu UTC +01:00)."
    )
    assert now_line(datetime(2026, 7, 1, 8, 0, tzinfo=UTC)).endswith("(Versatz zu UTC +02:00).")
