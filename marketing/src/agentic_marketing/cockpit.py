"""Talking to the cockpit database.

Context: The app and the scheduled jobs share one Supabase project; this module is the jobs'
side of it, a thin client over the REST interface of the `marketing` schema. It knows no
campaign logic, only rows. | Input: the service key and table names. | Output: rows as
dictionaries.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from typing import Any, Self

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from agentic_marketing.config import Settings
from agentic_marketing.errors import CockpitError

logger = logging.getLogger(__name__)

SCHEMA = "marketing"
REQUEST_TIMEOUT = 30.0
Row = dict[str, Any]


def _transient(error: BaseException) -> bool:
    """Whether a failed request is worth repeating."""
    if isinstance(error, httpx.TimeoutException | httpx.NetworkError | httpx.RemoteProtocolError):
        return True
    return isinstance(error, httpx.HTTPStatusError) and error.response.status_code >= 500


class CockpitClient:
    """Rows in and out of the `marketing` schema."""

    def __init__(
        self, base_url: str, service_key: str, *, transport: httpx.BaseTransport | None = None
    ):
        headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Accept-Profile": SCHEMA,
            "Content-Profile": SCHEMA,
        }
        self._http = httpx.Client(
            base_url=f"{base_url.rstrip('/')}/rest/v1",
            headers=headers,
            timeout=REQUEST_TIMEOUT,
            transport=transport,
        )

    @classmethod
    def from_settings(cls, settings: Settings) -> Self:
        """Build a client from the environment.

        Raises:
            CockpitError: If the address or the service key is not configured.
        """
        if not settings.supabase_url or settings.supabase_service_key is None:
            raise CockpitError(
                "set AGENTIC_MARKETING_SUPABASE_URL and AGENTIC_MARKETING_SUPABASE_SERVICE_KEY"
            )
        return cls(settings.supabase_url, settings.supabase_service_key.get_secret_value())

    def close(self) -> None:
        """Release the connection pool."""
        self._http.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @retry(
        retry=retry_if_exception(_transient),
        wait=wait_exponential(multiplier=1, max=20),
        stop=stop_after_attempt(4),
        reraise=True,
    )
    def _send(self, request: httpx.Request) -> httpx.Response:
        response = self._http.send(request)
        response.raise_for_status()
        return response

    def _call(self, method: str, path: str, **kwargs: Any) -> Any:
        request = self._http.build_request(method, path, **kwargs)
        try:
            response = self._send(request)
        except httpx.HTTPStatusError as error:
            raise CockpitError(f"{method} {path} failed: {error.response.text[:300]}") from error
        except httpx.HTTPError as error:
            raise CockpitError(f"{method} {path} failed: {error}") from error
        if not response.content:
            return None
        return response.json()

    def select(self, table: str, params: Mapping[str, str]) -> list[Row]:
        """Read rows with PostgREST filter parameters, e.g. {"status": "eq.approved"}."""
        result = self._call("GET", f"/{table}", params=dict(params))
        return list(result or [])

    def upsert(
        self, table: str, rows: Sequence[Mapping[str, Any]], *, on_conflict: str
    ) -> list[Row]:
        """Insert rows or update them where the conflict columns already match."""
        if not rows:
            return []
        result = self._call(
            "POST",
            f"/{table}",
            params={"on_conflict": on_conflict},
            json=list(rows),
            headers={"Prefer": "resolution=merge-duplicates,return=representation"},
        )
        return list(result or [])

    def insert(self, table: str, rows: Sequence[Mapping[str, Any]]) -> list[Row]:
        """Insert rows and return them as stored."""
        if not rows:
            return []
        result = self._call(
            "POST", f"/{table}", json=list(rows), headers={"Prefer": "return=representation"}
        )
        return list(result or [])

    def update(
        self, table: str, filters: Mapping[str, str], values: Mapping[str, Any]
    ) -> list[Row]:
        """Change the rows matching the filters and return them."""
        result = self._call(
            "PATCH",
            f"/{table}",
            params=dict(filters),
            json=dict(values),
            headers={"Prefer": "return=representation"},
        )
        return list(result or [])

    def delete(self, table: str, filters: Mapping[str, str]) -> None:
        """Remove the rows matching the filters."""
        self._call("DELETE", f"/{table}", params=dict(filters))

    def rpc(self, function: str, arguments: Mapping[str, Any]) -> Any:
        """Call a database function of the schema."""
        return self._call("POST", f"/rpc/{function}", json=dict(arguments))

    def log_event(
        self, campaign_id: str, kind: str, *, post_id: str | None = None, note: str | None = None
    ) -> None:
        """Append one line to the campaign history."""
        self.insert(
            "events",
            [
                {
                    "campaign_id": campaign_id,
                    "post_id": post_id,
                    "kind": kind,
                    "actor": "system",
                    "note": note,
                }
            ],
        )
        logger.info("event %s for campaign %s", kind, campaign_id)
