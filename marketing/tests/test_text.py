"""Tests for text.

Context: Figure matching decides every verdict, so its edge cases are pinned here. |
Input: strings. | Output: assertions.
"""

from __future__ import annotations

import pytest

from agentic_marketing.text import (
    contains_figure,
    estimate_tokens,
    figure_pattern,
    figure_variants,
    normalise,
    sentence_with_figure,
    slugify,
)


@pytest.mark.parametrize(
    ("haystack", "figure"),
    [
        ("Der Anteil liegt bei 45,8 Prozent", "45,8"),
        ("The share is 45.8 percent", "45,8"),
        ("insgesamt 90.336 Personen", "90 336"),
        ("insgesamt 90336 Personen", "90.336"),
        ("Anteil 45,8 %", "45,8 %"),
    ],
)
def test_figure_is_found_across_spellings(haystack: str, figure: str) -> None:
    assert contains_figure(haystack, figure)


@pytest.mark.parametrize(
    ("haystack", "figure"),
    [
        ("gilt seit\ndem 1. Januar 2026 fuer alle Betriebe", "1. Januar 2026"),
        ("Stand: 30. Juni 2026, vorlaeufig", "30. Juni 2026"),
        ("ein Plus von 2,3 Prozent im Jahr", "2,3 Prozent"),
    ],
)
def test_separators_next_to_words_match_as_written(haystack: str, figure: str) -> None:
    """The dot of a date and the space before a word are text, not parts of a number."""
    assert contains_figure(haystack, figure)


def test_a_date_is_not_found_with_a_different_day() -> None:
    assert not contains_figure("seit dem 11. Januar 2026", "1. Januar 2026")


def test_absent_figure_is_not_found() -> None:
    assert not contains_figure("Der Anteil liegt bei 45,8 Prozent", "11,4")


@pytest.mark.parametrize(
    ("haystack", "figure"),
    [
        ("Am 17. September 2026 gemeldet", "1,7"),
        ("Es waren 116 Betriebe", "11,6"),
        ("Der Wert betraegt 145,88 Prozent", "45,8"),
        ("Insgesamt 1.234.567 Stueck", "234,5"),
    ],
)
def test_a_decimal_separator_is_never_dropped(haystack: str, figure: str) -> None:
    """Removing a decimal comma turns 1,7 into 17, which is a different number."""
    assert not contains_figure(haystack, figure)


def test_a_thousands_separator_may_be_dropped() -> None:
    assert contains_figure("waren rund 5 150 Betriebe", "5.150")
    assert contains_figure("waren rund 5150 Betriebe", "5.150")


def test_variants_show_what_was_looked_for() -> None:
    assert figure_variants("1,7") == {"1,7", "1.7"}
    assert figure_variants("90.336") == {"90.336", "90,336", "90 336", "90336"}
    assert figure_variants("1. Januar 2026") == {"1. Januar 2026"}


def test_a_figure_without_digits_has_no_pattern() -> None:
    assert figure_pattern("keine Zahl") is None


def test_variants_of_an_empty_figure_are_empty() -> None:
    assert figure_variants("   ") == set()
    assert figure_pattern("   ") is None


def test_normalise_unifies_the_spaces_sources_use_in_numbers() -> None:
    assert normalise("90\u202f336") == "90 336"


def test_slugify_strips_accents_and_punctuation() -> None:
    assert slugify("Berufsträger, 56+") == "berufstrager-56"


def test_token_estimate_rounds_up() -> None:
    assert estimate_tokens("x" * 5) == 2
    assert estimate_tokens("") == 0


def test_evidence_is_the_sentence_that_holds_the_figure() -> None:
    text = "Erster Satz ohne Zahl. Im Mai waren es 45,8 Prozent. Dritter Satz."
    assert sentence_with_figure(text, "45,8") == "Im Mai waren es 45,8 Prozent."


def test_a_date_does_not_end_the_evidence_sentence() -> None:
    text = "Vorweg. Seit dem 1. Januar 2026 gilt die Pflicht fuer alle. Danach mehr."
    assert sentence_with_figure(text, "1. Januar 2026") == (
        "Seit dem 1. Januar 2026 gilt die Pflicht fuer alle."
    )


def test_a_heading_above_the_sentence_is_not_quoted() -> None:
    text = "Seite 7, Betriebsgroessen\n\nVon 12.480 Betrieben sind 61,4 Prozent klein."
    assert sentence_with_figure(text, "61,4") == "Von 12.480 Betrieben sind 61,4 Prozent klein."


def test_evidence_in_the_last_sentence_and_for_an_absent_figure() -> None:
    assert sentence_with_figure("Vorweg. Zuletzt 12.480 Betriebe", "12.480") == (
        "Zuletzt 12.480 Betriebe"
    )
    assert sentence_with_figure("Keine passende Zahl.", "11,4") is None
