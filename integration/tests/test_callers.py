"""Every database call in the source of every RepoCity part matches the built database.

Context: The apps, the Edge Functions and the RadarAuditor worker name functions, arguments, tables,
columns, embeds and conflict keys in their source; a typo or a renamed column only shows when that
screen is opened. This reads every call statically and checks it against the catalog of the project
the tests build, with the rights of the role that caller runs as. | Input: the repository source and
the template database. | Output: Assertions that no call misses its target.
"""

import pytest

from repocity_integration.callers import references
from repocity_integration.catalog import Catalog, check_all, read_catalog
from repocity_integration.cluster import PostgresCluster
from repocity_integration.database import Database
from repocity_integration.project import REPOSITORY
from repocity_integration.references import Embed, Reference

# Rows built from a list the caller passes in; the scenario tests write the same shapes.
UNRESOLVED = {
    "radarauditor/src/radarauditor/db/repositories.py check_results payload rows",
    "radarauditor/src/radarauditor/db/repositories.py findings payload rows",
}


@pytest.fixture(scope="module")
def catalog(cluster: PostgresCluster, template: str) -> Catalog:
    return read_catalog(cluster.conninfo(template))


@pytest.fixture(scope="module")
def calls() -> list[Reference]:
    return references(REPOSITORY)


def test_every_part_is_scanned(calls: list[Reference]) -> None:
    folders = {reference.location.split("/")[0] for reference in calls}
    assert folders == {"crm", "cockpit", "radarauditor"}
    assert len(calls) > 250


def test_the_appointment_page_calls_its_four_functions_with_the_service_key(
    calls: list[Reference],
) -> None:
    termin = {
        (reference.name, reference.role)
        for reference in calls
        if reference.location.startswith("crm/supabase/functions/crm-termin/")
    }

    assert termin == {
        ("audit_offer_view", "service_role"),
        ("book_audit_offer", "service_role"),
        ("audit_reschedule_view", "service_role"),
        ("request_audit_reschedule", "service_role"),
    }


def test_every_call_matches_a_function_or_table_the_caller_may_use(
    catalog: Catalog, calls: list[Reference]
) -> None:
    assert check_all(catalog, calls) == []


def test_only_the_known_calls_cannot_be_read_statically(calls: list[Reference]) -> None:
    unresolved = {
        f"{r.location.split(':')[0]} {r.name} {r.unresolved}" for r in calls if r.unresolved
    }
    assert unresolved == UNRESOLVED


def _problems(catalog: Catalog, **fields: object) -> list[str]:
    defaults: dict[str, object] = {
        "location": "x.ts:1",
        "role": "authenticated",
        "schema": "crm",
        "kind": "table",
        "name": "customers",
    }
    return check_all(catalog, [Reference(**{**defaults, **fields})])  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("fields", "problem"),
    [
        ({"columns": frozenset({"mail"})}, "column crm.customers.mail does not exist"),
        ({"name": "customer"}, "table crm.customer does not exist"),
        (
            {
                "kind": "rpc",
                "name": "send_quote",
                "action": "execute",
                "arguments": frozenset({"p_id"}),
            },
            "send_quote(p_id) fits no signature (p_quote)",
        ),
        (
            {
                "kind": "rpc",
                "name": "intake_call",
                "action": "execute",
                "arguments": frozenset(
                    {"p_caller_number", "p_name", "p_company", "p_email", "p_subject", "p_message"}
                ),
            },
            "authenticated may not run intake_call",
        ),
        ({"name": "calls", "action": "insert"}, "authenticated has no insert right on calls"),
        (
            {"name": "quotes", "embeds": (Embed("products", frozenset()),)},
            "no foreign key between crm.quotes and crm.products for the embed",
        ),
        (
            {"action": "upsert", "conflict": ("name",)},
            "on_conflict (name) matches no unique key of customers",
        ),
        (
            {"schema": "cockpit", "name": "push_keys", "role": "authenticated"},
            "authenticated has no select right on push_keys",
        ),
    ],
)
def test_the_check_names_each_kind_of_mismatch(
    catalog: Catalog, fields: dict[str, object], problem: str
) -> None:
    assert [line.split(": ", 1)[1] for line in _problems(catalog, **fields)] == [problem]


def test_a_right_without_a_row_level_security_policy_is_a_mismatch(db: Database) -> None:
    db.run(
        "create table crm.probe (id int); alter table crm.probe enable row level security; "
        "grant select on crm.probe to authenticated"
    )
    assert _problems(read_catalog(db.conninfo), name="probe") == [
        "x.ts:1 crm.probe: no row level security policy lets authenticated select probe"
    ]
