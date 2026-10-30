"""Client of the CRM functions and tables the phone assistant uses.

Context: Supabase PostgREST with the service key, schema `crm` chosen per request through the
Accept-Profile and Content-Profile headers. | Input: caller number and what the caller asked
for. | Output: business facts, the matching customer, inquiries, callbacks, quote decisions,
call records.
"""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from datetime import datetime
from decimal import Decimal
from types import TracebackType
from typing import Literal, Self
from uuid import UUID

import httpx
from pydantic import BaseModel, TypeAdapter, ValidationError
from tenacity import AsyncRetrying, retry_if_exception, stop_after_attempt, wait_exponential

from .errors import CrmError, CrmUnavailableError
from .facts import BusinessFacts, Product

logger = logging.getLogger(__name__)

SCHEMA = "crm"
QuoteIntent = Literal["accept", "decline"]
ATTEMPTS = 3
RETRY_WAIT_SECONDS = 0.5
_MAX_RETRY_WAIT_SECONDS = 4.0
_CONNECT_TIMEOUT_SECONDS = 3.0
_RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
_NOT_PROCESSED_STATUSES = frozenset({429, 503})


class _SettingsRow(BaseModel):
    assistant_greeting: str
    assistant_facts: str
    small_business: bool


class _ProductRow(BaseModel):
    name: str
    description: str
    price_net: Decimal
    vat_rate: Decimal
    billing: Literal["once", "monthly"]


class _CustomerRow(BaseModel):
    name: str
    contact_person: str


@dataclass(frozen=True)
class KnownCaller:
    """Customer whose stored phone number matches the caller."""

    customer_id: UUID
    name: str
    contact_person: str


@dataclass(frozen=True)
class IntakeRequest:
    """Arguments of crm.intake_call in contract order."""

    caller_number: str
    name: str
    company: str
    email: str | None
    subject: str
    message: str
    # One value of crm.is_channel, or empty when the caller did not say how they found RepoCity.
    channel: str = ""


class QuoteDecision(BaseModel):
    """Answer of crm.phone_quote_decision."""

    done: bool
    text: str


class _UnavailableError(CrmUnavailableError):
    def __init__(self, message: str, *, reached_server: bool) -> None:
        super().__init__(message)
        self.reached_server = reached_server


def longest_request_seconds(
    timeout_seconds: float,
    *,
    attempts: int = ATTEMPTS,
    retry_wait_seconds: float = RETRY_WAIT_SECONDS,
) -> float:
    """Return how long one CRM request may take with every try and every pause between tries.

    Args:
        timeout_seconds: Upper bound for one request, as given to CrmClient.
        attempts: Tries per request.
        retry_wait_seconds: First pause between tries, doubled each time.

    Returns:
        Seconds until the client has an answer or gives up.
    """
    per_try = timeout_seconds + min(timeout_seconds, _CONNECT_TIMEOUT_SECONDS)
    pauses = sum(
        min(retry_wait_seconds * 2.0**index, _MAX_RETRY_WAIT_SECONDS)
        for index in range(attempts - 1)
    )
    return attempts * per_try + pauses


def _parse[T](adapter: TypeAdapter[T], payload: object, what: str) -> T:
    try:
        return adapter.validate_python(payload)
    except ValidationError as error:
        raise CrmError(f"unexpected answer from {what}: {error.error_count()} problems") from error


class CrmClient:
    """Async client of the CRM; use as an async context manager."""

    def __init__(
        self,
        supabase_url: str,
        service_key: str,
        *,
        timeout_seconds: float = 10.0,
        attempts: int = ATTEMPTS,
        retry_wait_seconds: float = RETRY_WAIT_SECONDS,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        """Create the client.

        Args:
            supabase_url: Project address, for example https://xyz.supabase.co.
            service_key: Service role key; the phone functions accept only this role.
            timeout_seconds: Upper bound for one request.
            attempts: Tries per request when the CRM is temporarily unavailable.
            retry_wait_seconds: First pause between tries, doubled each time.
            transport: Replacement transport, used by tests.
        """
        self._http = httpx.AsyncClient(
            base_url=f"{supabase_url.rstrip('/')}/rest/v1",
            headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
            timeout=httpx.Timeout(
                timeout_seconds, connect=min(timeout_seconds, _CONNECT_TIMEOUT_SECONDS)
            ),
            transport=transport,
        )
        self._attempts = attempts
        self._retry_wait_seconds = retry_wait_seconds

    async def __aenter__(self) -> Self:
        """Return the open client."""
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        """Close the connection pool."""
        await self.aclose()

    async def aclose(self) -> None:
        """Close the connection pool."""
        await self._http.aclose()

    async def load_facts(self) -> BusinessFacts:
        """Read the greeting, the business facts and every active product.

        Returns:
            Facts the assistant may say.

        Raises:
            CrmError: If the settings row is missing or a row has an unexpected shape.
        """
        settings_rows = await self._get(
            "settings",
            {"select": "assistant_greeting,assistant_facts,small_business", "id": "eq.1"},
        )
        settings = _parse(TypeAdapter(list[_SettingsRow]), settings_rows, "settings")
        if not settings:
            raise CrmError("crm.settings has no row")
        product_rows = await self._get(
            "products",
            {
                "select": "name,description,price_net,vat_rate,billing",
                "active": "eq.true",
                "order": "name",
            },
        )
        products = _parse(TypeAdapter(list[_ProductRow]), product_rows, "products")
        return BusinessFacts(
            greeting=settings[0].assistant_greeting,
            facts=settings[0].assistant_facts,
            small_business=settings[0].small_business,
            products=tuple(Product(**row.model_dump()) for row in products),
        )

    async def find_customer(self, caller_number: str) -> KnownCaller | None:
        """Find the customer whose stored phone number is the caller's number.

        The CRM compares numbers with crm.customer_by_phone, the same rule crm.intake_call and
        crm.record_call use, so all three agree on who is calling.

        Args:
            caller_number: Number reported by the phone line.

        Returns:
            The oldest matching customer, or None for unknown or suppressed numbers.
        """
        if not caller_number.strip():
            return None
        found = await self._rpc("customer_by_phone", {"p_number": caller_number}, idempotent=True)
        customer_id = _parse(TypeAdapter(UUID | None), found, "customer_by_phone")
        if customer_id is None:
            return None
        rows = await self._get(
            "customers", {"select": "name,contact_person", "id": f"eq.{customer_id}"}
        )
        customers = _parse(TypeAdapter(list[_CustomerRow]), rows, "customers")
        if not customers:
            return None
        return KnownCaller(customer_id, customers[0].name, customers[0].contact_person)

    async def intake_call(self, request: IntakeRequest) -> UUID:
        """File the caller's request as an inquiry with a callback task.

        Args:
            request: What the caller told the assistant.

        Returns:
            Id of the found or created customer.
        """
        answer = await self._rpc(
            "intake_call",
            {f"p_{key}": value for key, value in asdict(request).items()},
            idempotent=False,
        )
        return _parse(TypeAdapter(UUID), answer, "intake_call")

    async def callback_from_call(
        self, caller_number: str, name: str, reason: str, wished_at: datetime | None
    ) -> UUID:
        """Book the callback the caller asked for; the CRM tells Daniel in the Cockpit.

        The CRM books the wished time when it lies ahead, within 60 days and inside business
        hours, otherwise a callback today without a time, with the wish in the note.

        Args:
            caller_number: Number reported by the phone line, empty when suppressed.
            name: Caller's name, empty when not known.
            reason: What the callback is about.
            wished_at: Wished time with time zone, None when the caller named none.

        Returns:
            Id of the booked appointment.
        """
        answer = await self._rpc(
            "callback_from_call",
            {
                "p_caller_number": caller_number,
                "p_name": name,
                "p_reason": reason,
                "p_wished_at": wished_at.isoformat() if wished_at is not None else None,
            },
            idempotent=False,
        )
        return _parse(TypeAdapter(UUID), answer, "callback_from_call")

    async def phone_quote_decision(
        self, caller_number: str, quote_number: str, intent: QuoteIntent, summary: str
    ) -> QuoteDecision:
        """Accept or decline a quote by phone, or hand the decision to Daniel.

        Args:
            caller_number: Number reported by the phone line.
            quote_number: Quote number the caller named, e.g. AN-2026-0004.
            intent: `accept` or `decline`.
            summary: Short note of what the caller said.

        Returns:
            Whether the CRM decided, and the German sentence to read out.
        """
        answer = await self._rpc(
            "phone_quote_decision",
            {
                "p_caller_number": caller_number,
                "p_quote_number": quote_number,
                "p_intent": intent,
                "p_summary": summary,
            },
            idempotent=False,
        )
        return _parse(TypeAdapter(QuoteDecision), answer, "phone_quote_decision")

    async def record_call(self, payload: dict[str, object]) -> UUID:
        """Store a finished call; a repeated delivery returns the stored id.

        Args:
            payload: Output of CallLog.to_payload.

        Returns:
            Id of the stored call.
        """
        answer = await self._rpc("record_call", {"p_call": payload}, idempotent=True)
        return _parse(TypeAdapter(UUID), answer, "record_call")

    async def _get(self, table: str, params: dict[str, str]) -> object:
        async def send() -> httpx.Response:
            return await self._http.get(
                f"/{table}", params=params, headers={"Accept-Profile": SCHEMA}
            )

        return await self._with_retries(send, idempotent=True, what=table)

    async def _rpc(
        self, function: str, arguments: dict[str, object], *, idempotent: bool
    ) -> object:
        async def send() -> httpx.Response:
            return await self._http.post(
                f"/rpc/{function}", json=arguments, headers={"Content-Profile": SCHEMA}
            )

        return await self._with_retries(send, idempotent=idempotent, what=function)

    async def _with_retries(
        self, send: Callable[[], Awaitable[httpx.Response]], *, idempotent: bool, what: str
    ) -> object:
        def worth_retrying(error: BaseException) -> bool:
            if not isinstance(error, _UnavailableError):
                return False
            return idempotent or not error.reached_server

        retrying = AsyncRetrying(
            retry=retry_if_exception(worth_retrying),
            stop=stop_after_attempt(self._attempts),
            wait=wait_exponential(multiplier=self._retry_wait_seconds, max=_MAX_RETRY_WAIT_SECONDS),
            reraise=True,
        )
        async for attempt in retrying:
            with attempt:
                return await _send_once(send, what)
        raise AssertionError("tenacity always returns or raises")


async def _send_once(send: Callable[[], Awaitable[httpx.Response]], what: str) -> object:
    try:
        response = await send()
    except (httpx.ConnectError, httpx.ConnectTimeout) as error:
        raise _UnavailableError(f"CRM not reachable for {what}", reached_server=False) from error
    except httpx.TransportError as error:
        raise _UnavailableError(
            f"CRM did not answer {what} in time", reached_server=True
        ) from error
    if response.status_code in _RETRY_STATUSES:
        logger.warning("CRM answered %s with status %s", what, response.status_code)
        reached = response.status_code not in _NOT_PROCESSED_STATUSES
        raise _UnavailableError(f"CRM busy for {what}", reached_server=reached)
    if response.is_error:
        raise CrmError(f"CRM refused {what}: {_error_message(response)}")
    return response.json()


def _error_message(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return f"status {response.status_code}"
    if isinstance(body, dict) and isinstance(body.get("message"), str):
        return str(body["message"])
    return f"status {response.status_code}"
