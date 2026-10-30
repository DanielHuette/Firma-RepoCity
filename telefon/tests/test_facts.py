"""Tests of the greeting and the instructions built from business facts."""

from datetime import UTC, datetime
from decimal import Decimal

from repocity_telefon.channels import CHANNEL_LABELS
from repocity_telefon.facts import (
    DEFAULT_GREETING,
    BusinessFacts,
    Product,
    build_instructions,
    describe_price,
    opening_line,
)

WEBSITE_CHECK = Product(
    name="Sichtbarkeitsprüfung",
    description="Prüfung von Webseite und Google-Profil",
    price_net=Decimal("249.00"),
    vat_rate=Decimal("19"),
    billing="once",
)
MONTHLY_CARE = Product(
    name="Monatliche Pflege",
    description="Monatliche Prüfung mit Bericht",
    price_net=Decimal("49.50"),
    vat_rate=Decimal("19"),
    billing="monthly",
)
NOW = datetime(2026, 10, 30, 13, 5, tzinfo=UTC)


def facts(**changes: object) -> BusinessFacts:
    base: dict[str, object] = {
        "greeting": "",
        "facts": "Daniel arbeitet in Münster.",
        "small_business": False,
        "products": (WEBSITE_CHECK, MONTHLY_CARE),
    }
    base.update(changes)
    return BusinessFacts(**base)  # type: ignore[arg-type]


def test_empty_greeting_uses_default_with_ai_disclosure() -> None:
    line = opening_line(facts(greeting="  "))
    assert line == DEFAULT_GREETING
    assert "künstliche Intelligenz" in line
    assert "aufgeschrieben" in line
    assert "RepoCity" in line


def test_greeting_with_disclosure_is_spoken_as_written() -> None:
    greeting = (
        "Hallo bei RepoCity. Ich bin eine künstliche Intelligenz, das Gespräch wird aufgeschrieben."
    )
    assert opening_line(facts(greeting=greeting)) == greeting


def test_greeting_without_disclosure_gets_it_appended() -> None:
    line = opening_line(facts(greeting="Hallo bei RepoCity, wie kann ich helfen?"))
    assert line.startswith("Hallo bei RepoCity, wie kann ich helfen?")
    assert "künstliche Intelligenz" in line
    assert "aufgeschrieben" in line


def test_price_once_with_vat() -> None:
    assert describe_price(WEBSITE_CHECK, small_business=False) == (
        "249 Euro einmalig, zuzüglich 19 Prozent Umsatzsteuer"
    )


def test_price_monthly_with_cents() -> None:
    assert describe_price(MONTHLY_CARE, small_business=False) == (
        "49,50 Euro pro Monat, zuzüglich 19 Prozent Umsatzsteuer"
    )


def test_price_for_small_business_has_no_vat() -> None:
    assert describe_price(WEBSITE_CHECK, small_business=True) == (
        "249 Euro einmalig, ohne Umsatzsteuer, weil Kleinunternehmer"
    )


def test_price_with_zero_vat_rate() -> None:
    product = Product("Beratung", "", Decimal("80"), Decimal("0"), "once")
    assert describe_price(product, small_business=False) == "80 Euro einmalig, ohne Umsatzsteuer"


def test_instructions_contain_products_prices_and_facts() -> None:
    text = build_instructions(facts(), now=NOW)
    assert "Sichtbarkeitsprüfung: Prüfung von Webseite und Google-Profil" in text
    assert "249 Euro einmalig" in text
    assert "49,50 Euro pro Monat" in text
    assert "Daniel arbeitet in Münster." in text


def test_instructions_forbid_inventing() -> None:
    text = build_instructions(facts(), now=NOW)
    assert "Erfinde nie" in text


def test_instructions_without_products_forbid_prices() -> None:
    text = build_instructions(facts(products=(), facts=""), now=NOW)
    assert "Es sind keine Produkte hinterlegt. Nenne keine Preise." in text
    assert "Es sind keine weiteren Angaben hinterlegt." in text


def test_unavailable_facts_have_no_products() -> None:
    assert BusinessFacts.unavailable().products == ()


def test_product_without_description_is_listed_by_name() -> None:
    product = Product("Beratung", " ", Decimal("80"), Decimal("19"), "once")
    text = build_instructions(facts(products=(product,)), now=NOW)
    assert "- Beratung. Preis: 80 Euro einmalig" in text


def test_instructions_name_today_for_wished_callback_times() -> None:
    text = build_instructions(facts(), now=NOW)
    assert "Jetzt ist Freitag, 30. Oktober 2026, 14:05 Uhr deutscher Zeit" in text
    assert "+02:00 in der Sommerzeit" in text


def test_instructions_promise_only_what_the_crm_does_with_a_callback() -> None:
    text = build_instructions(facts(), now=NOW)
    assert "wiederhole Tag und Uhrzeit" in text
    assert "zu dieser Zeit, wenn sie passt, sonst so bald wie möglich" in text


def test_instructions_ask_how_the_caller_found_us_with_every_channel() -> None:
    text = build_instructions(facts(), now=NOW)
    assert "„Wie sind Sie auf uns aufmerksam geworden?“" in text
    for value, label in CHANNEL_LABELS.items():
        if value != "other":
            assert f"{value} für {label}" in text
    assert "other für alles andere" in text
