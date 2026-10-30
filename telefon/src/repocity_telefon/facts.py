"""Business facts the assistant may say, and the instructions built from them.

Context: the assistant must never invent prices, dates or promises, so everything it may say
comes from the CRM. | Input: crm.settings, active crm.products and the start of the call. |
Output: the opening line and the system instructions for the language model.
"""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Literal

from .channels import CHANNEL_LABELS, OTHER
from .spoken_time import now_line

Billing = Literal["once", "monthly"]

DISCLOSURE = (
    "Ich bin eine künstliche Intelligenz, kein Mensch. Unser Gespräch wird aufgeschrieben, "
    "damit Ihr Anliegen bearbeitet werden kann."
)
DEFAULT_GREETING = (
    f"Guten Tag, hier ist die digitale Assistentin von RepoCity. {DISCLOSURE} "
    "Wie kann ich Ihnen helfen?"
)
_DISCLOSURE_WORDS = ("künstliche intelligenz",)
_RECORDING_WORDS = ("aufgeschrieben", "aufgezeichnet", "mitgeschrieben")

_RULES = """Du bist die digitale Telefonassistentin von RepoCity, dem Geschäft von Daniel. \
Du bist eine künstliche Intelligenz und sagst das ehrlich, wenn jemand fragt.
Du sprichst Deutsch, siezt, antwortest kurz in Alltagssprache und ohne Aufzählungen oder \
Formatierung, denn alles wird vorgelesen.
Regeln:
- Sage nur, was unten in den Angaben und Produkten steht. Erfinde nie Preise, Termine, Fristen, \
Rabatte oder Zusagen. Weißt du etwas nicht, sage das und biete an, das Anliegen aufzunehmen, \
damit Daniel sich meldet.
- Nenne Preise genau so, wie sie unten stehen.
- Gib nie Auskunft über andere Kunden, Rechnungen oder interne Daten.
- Möchte jemand etwas von Daniel, frage nach Name, Firma und worum es geht. Eine E-Mail-Adresse \
nur, wenn der Anrufer sie nennen möchte. Frage außerdem: „Wie sind Sie auf uns aufmerksam \
geworden?“ Gib die Antwort als channel an, genau einer dieser Werte: {channels}. Antwortet der \
Anrufer nicht, lass channel leer. Dann nutze take_request.
- Möchte jemand ein Angebot annehmen oder ablehnen, frage nach der Angebotsnummer, zum Beispiel \
AN-2026-0004, lass dir die Absicht bestätigen und nutze decide_quote. Der Satz, den das Werkzeug \
liefert, wird dem Anrufer automatisch vorgelesen; wiederhole ihn nicht.
- Möchte jemand zurückgerufen werden, frage, wann es ihm passt. Nennt er eine Zeit, wiederhole \
Tag und Uhrzeit, wie du sie verstanden hast, und lass sie bestätigen. Nutze dann \
request_callback, mit wished_time als Datum und Uhrzeit nach deutscher Zeit mit Versatz zu UTC, \
zum Beispiel 2026-11-02T10:00:00+01:00: +02:00 in der Sommerzeit (vom letzten Sonntag im März \
bis zum letzten Sonntag im Oktober), sonst +01:00. Ohne genannte Zeit lass wished_time leer. \
Sage dem Anrufer nur, dass Daniel zurückruft: zu dieser Zeit, wenn sie passt, sonst so bald wie \
möglich. Versprich keine feste Uhrzeit.
- Mit look_up_caller prüfst du, ob die Nummer des Anrufers zu einem Kunden gehört.
- Ist alles besprochen, verabschiede dich kurz und nutze dann end_call."""


@dataclass(frozen=True)
class Product:
    """One active product as the assistant may describe it."""

    name: str
    description: str
    price_net: Decimal
    vat_rate: Decimal
    billing: Billing


@dataclass(frozen=True)
class BusinessFacts:
    """Everything the assistant may say about the business."""

    greeting: str
    facts: str
    small_business: bool
    products: tuple[Product, ...]

    @classmethod
    def unavailable(cls) -> "BusinessFacts":
        """Facts for a call during which the CRM could not be read: nothing to tell."""
        return cls(greeting="", facts="", small_business=False, products=())


def _discloses(text: str) -> bool:
    lowered = text.lower()
    return any(word in lowered for word in _DISCLOSURE_WORDS) and any(
        word in lowered for word in _RECORDING_WORDS
    )


def opening_line(facts: BusinessFacts) -> str:
    """Return the first sentence of every call; it always discloses the AI and the transcript.

    Args:
        facts: Business facts with the greeting edited in the CRM.

    Returns:
        The greeting from the CRM, with the disclosure appended when it lacks one, or the
        built-in greeting when none is set.
    """
    greeting = facts.greeting.strip()
    if not greeting:
        return DEFAULT_GREETING
    if _discloses(greeting):
        return greeting
    return f"{greeting} {DISCLOSURE}"


def _euro(amount: Decimal) -> str:
    if amount == amount.to_integral_value():
        return f"{int(amount)} Euro"
    return f"{amount.quantize(Decimal('0.01'))} Euro".replace(".", ",")


def describe_price(product: Product, *, small_business: bool) -> str:
    """Describe a price the way it is read out on the phone.

    Args:
        product: Product with net price, VAT rate and billing.
        small_business: True when the business invoices without VAT (Kleinunternehmer).

    Returns:
        For example "49,50 Euro pro Monat, zuzüglich 19 Prozent Umsatzsteuer".
    """
    period = "pro Monat" if product.billing == "monthly" else "einmalig"
    if small_business:
        tax = "ohne Umsatzsteuer, weil Kleinunternehmer"
    elif product.vat_rate == 0:
        tax = "ohne Umsatzsteuer"
    else:
        tax = f"zuzüglich {int(product.vat_rate)} Prozent Umsatzsteuer"
    return f"{_euro(product.price_net)} {period}, {tax}"


def _product_line(product: Product, *, small_business: bool) -> str:
    description = product.description.strip()
    title = f"{product.name}: {description}" if description else product.name
    return f"- {title}. Preis: {describe_price(product, small_business=small_business)}."


def _product_lines(facts: BusinessFacts) -> str:
    if not facts.products:
        return "Es sind keine Produkte hinterlegt. Nenne keine Preise."
    return "\n".join(
        _product_line(product, small_business=facts.small_business) for product in facts.products
    )


def _channel_choices() -> str:
    named = [f"{value} für {label}" for value, label in CHANNEL_LABELS.items() if value != OTHER]
    return f"{', '.join(named)}, {OTHER} für alles andere"


def build_instructions(facts: BusinessFacts, *, now: datetime) -> str:
    """Build the system instructions for the language model.

    Args:
        facts: Business facts from the CRM.
        now: Start of the call, so the model can turn "Montag um zehn" into a date.

    Returns:
        German instructions with the current time, rules, business facts and the product list.
    """
    business = facts.facts.strip() or "Es sind keine weiteren Angaben hinterlegt."
    rules = _RULES.format(channels=_channel_choices())
    return (
        f"{rules}\n\n{now_line(now)}\n\nAngaben zum Geschäft:\n{business}\n\n"
        f"Produkte und Preise:\n{_product_lines(facts)}"
    )
