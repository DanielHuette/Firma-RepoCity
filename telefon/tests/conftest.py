"""Shared fixtures: a CRM client wired to a scripted PostgREST."""

import json
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field

import httpx
import pytest

from repocity_telefon.crm import CrmClient

SUPABASE_URL = "https://crm.example.test"
SERVICE_KEY = "service-key-for-tests"

Handler = Callable[[httpx.Request], httpx.Response]


@dataclass
class ScriptedPostgrest:
    """Answers requests from a queue of handlers and remembers every request."""

    handlers: list[Handler] = field(default_factory=list)
    requests: list[httpx.Request] = field(default_factory=list)

    def reply(self, status: int, body: object) -> None:
        content = json.dumps(body).encode()
        headers = {"Content-Type": "application/json"}
        self.handlers.append(
            lambda _request: httpx.Response(status, content=content, headers=headers)
        )

    def fail(self, error: Exception) -> None:
        def raise_error(_request: httpx.Request) -> httpx.Response:
            raise error

        self.handlers.append(raise_error)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if not self.handlers:
            raise AssertionError(f"unexpected request {request.method} {request.url}")
        return self.handlers.pop(0)(request)

    def body(self, index: int) -> object:
        return json.loads(self.requests[index].content)


@pytest.fixture
def postgrest() -> ScriptedPostgrest:
    return ScriptedPostgrest()


@pytest.fixture
async def crm(postgrest: ScriptedPostgrest) -> AsyncIterator[CrmClient]:
    client = CrmClient(
        SUPABASE_URL,
        SERVICE_KEY,
        transport=httpx.MockTransport(postgrest),
        retry_wait_seconds=0,
    )
    async with client:
        yield client
