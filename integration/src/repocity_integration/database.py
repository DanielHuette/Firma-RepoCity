"""Run statements against a test database as one of the callers Supabase knows.

Context: Every call is one transaction that first switches to the caller's role and token claims,
the way PostgREST does for a request. | Input: a connection string. | Output: Caller, the callers
ADMIN, READER, ANON, SERVICE and SUPERUSER, and Database with rows, one, value and run.
"""

import json
from dataclasses import dataclass
from types import TracebackType
from typing import Any, LiteralString, Self
from uuid import UUID

import psycopg
from psycopg import sql as psql
from psycopg.rows import dict_row

from repocity_integration.project import ADMIN_ID, READER_ID

Params = tuple[Any, ...] | dict[str, Any] | None
Query = LiteralString | bytes


@dataclass(frozen=True)
class Caller:
    """Who runs a statement: a database role and the user Supabase would put in the token.

    Attributes:
        role: Role to switch to; None stays the superuser that migrations and stubs use.
        user_id: Subject of the token; None for a caller without sign-in.
    """

    role: str | None
    user_id: UUID | None = None

    def claims(self) -> str:
        """Token claims as PostgREST sets them in request.jwt.claims."""
        if self.role is None:
            return ""
        claims: dict[str, str] = {"role": self.role}
        if self.user_id is not None:
            claims["sub"] = str(self.user_id)
        return json.dumps(claims)


ADMIN = Caller("authenticated", ADMIN_ID)
READER = Caller("authenticated", READER_ID)
ANON = Caller("anon")
SERVICE = Caller("service_role")
SUPERUSER = Caller(None)


class Database:
    """One open connection to a test database; each call runs in its own transaction."""

    def __init__(self, conninfo: str) -> None:
        """Connect in autocommit mode, so every call controls its own transaction."""
        self.conninfo = conninfo
        self._connection = psycopg.connect(conninfo, autocommit=True, row_factory=dict_row)

    def close(self) -> None:
        """Close the connection."""
        self._connection.close()

    def __enter__(self) -> Self:
        """Use the open connection."""
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        """Close the connection."""
        self.close()

    def rows(
        self, sql: Query, params: Params = None, caller: Caller = SUPERUSER
    ) -> list[dict[str, Any]]:
        """Run one statement as the caller and answer its rows; nothing is kept when it fails.

        Raises:
            psycopg.Error: If the statement fails.
        """
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute("select set_config('request.jwt.claims', %s, true)", (caller.claims(),))
            if caller.role is not None:
                cursor.execute(psql.SQL("set local role {}").format(psql.Identifier(caller.role)))
            cursor.execute(sql, params)
            return cursor.fetchall() if cursor.description is not None else []

    def one(self, sql: Query, params: Params = None, caller: Caller = SUPERUSER) -> Any:
        """Answer the single row of a statement.

        Raises:
            AssertionError: If the statement answers no row or more than one.
        """
        found = self.rows(sql, params, caller)
        assert len(found) == 1, f"expected one row, got {found}"
        return found[0]

    def value(self, sql: Query, params: Params = None, caller: Caller = SUPERUSER) -> Any:
        """Answer the single value of a statement that returns one row with one column."""
        row = self.one(sql, params, caller)
        assert len(row) == 1, f"expected one column, got {row}"
        return next(iter(row.values()))

    def run(self, sql: Query, params: Params = None, caller: Caller = SUPERUSER) -> None:
        """Run statements for their effect; several statements are allowed without params."""
        self.rows(sql, params, caller)
