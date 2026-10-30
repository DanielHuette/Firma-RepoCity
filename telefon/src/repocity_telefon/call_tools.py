"""What the assistant's tools do during a call, independent of the voice pipeline.

Context: the language model decides when a tool runs; this module does the CRM work and words the
result in German for the model or, for quote decisions, for the caller. | Input: arguments the
model extracted from the conversation. | Output: CRM writes, outcome marks in the call log, German
result texts.
"""

import asyncio
import logging
import re
from datetime import datetime

from .call_log import CallLog
from .channels import channel_value
from .crm import CrmClient, IntakeRequest, QuoteIntent
from .errors import CrmError
from .spoken_time import spoken_when

logger = logging.getLogger(__name__)

REQUEST_FILED = "Das Anliegen ist aufgenommen. Daniel meldet sich persönlich."
REQUEST_ALREADY_FILED = (
    "Das Anliegen ist bereits aufgenommen. Ergänzungen stehen im Gesprächsprotokoll, "
    "das Daniel nach dem Anruf bekommt."
)
REQUEST_KEPT_IN_TRANSCRIPT = (
    "Das Anliegen konnte gerade nicht direkt eingetragen werden, steht aber im "
    "Gesprächsprotokoll, das Daniel nach dem Anruf bekommt. Er meldet sich persönlich."
)
DECISION_HANDED_ON = (
    "Vielen Dank. Ich habe Ihre Rückmeldung notiert. Daniel prüft sie persönlich und meldet sich."
)
CALLBACK_NOTED = "Der Rückrufwunsch ist notiert. Daniel ruft so bald wie möglich zurück."
CALLBACK_NOTED_AT = (
    "Der Rückrufwunsch ist notiert für {when}. Daniel ruft zu dieser Zeit zurück, wenn sie passt, "
    "sonst so bald wie möglich."
)
CALLBACK_ALREADY_NOTED = (
    "Der Rückrufwunsch ist bereits notiert. Ergänzungen stehen im Gesprächsprotokoll, "
    "das Daniel nach dem Anruf bekommt."
)
CALLBACK_KEPT_IN_TRANSCRIPT = (
    "Der Rückrufwunsch konnte gerade nicht direkt eingetragen werden, steht aber im "
    "Gesprächsprotokoll, das Daniel nach dem Anruf bekommt. Er ruft so bald wie möglich zurück."
)
CALLBACK_TIME_UNREADABLE = (
    "Die gewünschte Zeit ist nicht im verlangten Format und wurde nicht notiert. Nutze "
    "request_callback noch einmal mit wished_time wie 2026-11-02T10:00:00+01:00, oder leer, "
    "wenn der Anrufer keine Zeit genannt hat."
)
_QUOTE_NUMBER = re.compile(r"^([A-Z]*)([0-9]{4})0*([0-9]+)$")


def wished_time(text: str) -> datetime | None:
    """Read the wished callback time the model passed.

    Args:
        text: ISO 8601 date and time with offset, empty when the caller named no time.

    Returns:
        The time, or None when none was named.

    Raises:
        ValueError: If the text is no ISO 8601 date and time with an offset.
    """
    if not text.strip():
        return None
    moment = datetime.fromisoformat(text.strip())
    if moment.tzinfo is None:
        raise ValueError(f"no offset in {text!r}")
    return moment


def quote_key(spoken: str) -> str:
    """Return the key crm.quote_key gives a spoken quote number.

    Args:
        spoken: Quote number as the caller said it, e.g. "an 2026 4".

    Returns:
        The same key the CRM compares, e.g. "AN2026-4" for AN-2026-0004.
    """
    compact = "".join(character for character in spoken if character.isalnum()).upper()
    return _QUOTE_NUMBER.sub(r"\1\2-\3", compact)


class CallTools:
    """Tool actions of one call."""

    def __init__(self, crm: CrmClient, log: CallLog) -> None:
        """Bind the tools to the CRM and to the record of this call.

        Args:
            crm: Open CRM client.
            log: Record of the running call; tools set the customer and the outcome.
        """
        self._crm = crm
        self._log = log
        self._request_filed = False
        self._callback_booked = False
        self._caller_name = ""
        self._decisions: dict[tuple[str, QuoteIntent], str] = {}
        self._decision_lock = asyncio.Lock()

    async def look_up_caller(self) -> str:
        """Tell the model whether the caller's number belongs to a customer."""
        if not self._log.caller_number.strip():
            return "Die Rufnummer des Anrufers ist unterdrückt. Frage nach dem Namen."
        try:
            caller = await self._crm.find_customer(self._log.caller_number)
        except CrmError:
            logger.exception("Caller lookup failed")
            return "Das Kundenverzeichnis ist gerade nicht erreichbar."
        if caller is None:
            return "Die Rufnummer gehört zu keinem Kunden."
        self._log.customer_id = caller.customer_id
        person = f", Ansprechpartner {caller.contact_person}" if caller.contact_person else ""
        return f"Die Rufnummer gehört zum Kunden {caller.name}{person}."

    async def take_request(
        self, name: str, company: str, email: str, subject: str, message: str, channel: str = ""
    ) -> str:
        """File the caller's request with crm.intake_call, at most once per call.

        Args:
            name: Caller's name.
            company: Caller's company, empty for private persons.
            email: E-mail address as spoken, empty when none was given.
            subject: A few words on what the request is about.
            message: The request in the caller's words.
            channel: Value the model picked for how the caller found RepoCity, empty without
                an answer; a value not on the list is stored as "other".

        Returns:
            German result text for the model.
        """
        if self._request_filed:
            return REQUEST_ALREADY_FILED
        self._request_filed = True
        self._caller_name = name.strip()
        self._log.mark("inquiry")
        request = IntakeRequest(
            self._log.caller_number,
            name,
            company,
            email.strip() or None,
            subject,
            message,
            channel_value(channel),
        )
        try:
            self._log.customer_id = await self._crm.intake_call(request)
        except CrmError:
            logger.exception("Filing the request failed")
            return REQUEST_KEPT_IN_TRANSCRIPT
        return REQUEST_FILED

    async def decide_quote(self, quote_number: str, intent: QuoteIntent, summary: str) -> str:
        """Accept or decline a quote with crm.phone_quote_decision.

        Args:
            quote_number: Quote number as spoken, e.g. AN-2026-0004.
            intent: `accept` or `decline`.
            summary: Short note of what the caller said.

        Returns:
            The German sentence the caller hears, word for word.
        """
        # A second call for a quote already decided would reach Daniel as a Cockpit notice that
        # the quote is no longer open, so repeats in any spelling, even simultaneous ones, wait
        # for the first answer.
        key = (quote_key(quote_number), intent)
        async with self._decision_lock:
            if key in self._decisions:
                return self._decisions[key]
            try:
                decision = await self._crm.phone_quote_decision(
                    self._log.caller_number, quote_number, intent, summary
                )
            except CrmError:
                logger.exception("Quote decision failed")
                self._log.mark("callback")
                return DECISION_HANDED_ON
            if not decision.done:
                self._log.mark("callback")
            else:
                self._log.mark("quote_accepted" if intent == "accept" else "quote_declined")
            self._decisions[key] = decision.text
            return decision.text

    async def request_callback(self, reason: str, wished: str = "") -> str:
        """Book the callback the caller wants with crm.callback_from_call, once per call.

        Args:
            reason: What the callback is about.
            wished: Wished time as ISO 8601 with offset, empty when the caller named none.

        Returns:
            German result text for the model, with the understood time to repeat.
        """
        if self._callback_booked:
            return CALLBACK_ALREADY_NOTED
        try:
            wished_at = wished_time(wished)
        except ValueError:
            logger.warning("Wished callback time not readable")
            return CALLBACK_TIME_UNREADABLE
        self._callback_booked = True
        self._log.mark("callback")
        try:
            await self._crm.callback_from_call(
                self._log.caller_number, self._caller_name, reason, wished_at
            )
        except CrmError:
            logger.exception("Booking the callback failed")
            return CALLBACK_KEPT_IN_TRANSCRIPT
        if wished_at is None:
            return CALLBACK_NOTED
        return CALLBACK_NOTED_AT.format(when=spoken_when(wished_at))
