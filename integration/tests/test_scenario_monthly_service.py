"""S11 to S14: the monthly service drafts replies and profile care after the monthly audit.

Context: A reported monthly audit asks public.queue_monthly_service (migration 016) for one optimize
job on the order of the subscription; the worker stores the drafts and writes optimization.drafted
with purpose monthly; the Cockpit (008) sends one notice that links to the drafts. Daniel decides
each draft as before. | Input: an accepted order whose quote holds a monthly item. | Output:
Assertions on jobs, Cockpit messages, events and invoices.
"""

import json
from typing import Any

import psycopg
import pytest
from steps import accepted_order, finish_optimization, messages

from repocity_integration.database import ADMIN, SERVICE, Database


def _monthly_audit(db: Database, crm_customer: str) -> str:
    audit: str = db.value("select public.queue_monthly_audit(%s)", (crm_customer,), SERVICE)
    db.run("update public.audits set status = 'reported' where id = %s", (audit,), SERVICE)
    return audit


def _queue(db: Database, audit: str) -> Any:
    return db.value("select public.queue_monthly_service(%s)", (audit,), SERVICE)


def _drafted(db: Database, job: str, order: str, audit: str, purpose: str, drafts: int) -> None:
    payload = {
        "order_id": str(order),
        "job_id": str(job),
        "customer_id": "unused",
        "audit_id": str(audit),
        "purpose": purpose,
        "drafts": drafts,
    }
    db.run(
        "insert into public.events (kind, payload) values ('optimization.drafted', %s::jsonb)",
        (json.dumps(payload),),
        SERVICE,
    )


def test_s11_a_reported_monthly_audit_gets_one_optimize_job_on_the_subscription_order(
    db: Database,
) -> None:
    ids = accepted_order(db)
    finish_optimization(db, ids["order"])
    audit = _monthly_audit(db, ids["customer"])

    job = _queue(db, audit)

    assert _queue(db, audit) == job
    assert db.one(
        "select kind::text, status::text, audit_id, order_id from public.jobs where id = %s", (job,)
    ) == {"kind": "optimize", "status": "queued", "audit_id": audit, "order_id": ids["order"]}


def test_s12_without_a_subscription_order_nothing_is_queued(db: Database) -> None:
    ids = accepted_order(db)
    audit = _monthly_audit(db, ids["customer"])
    db.run("update crm.subscriptions set active = false")

    assert _queue(db, audit) is None
    assert db.value("select count(*) from public.jobs where kind = 'optimize'") == 0


def test_s12_a_sales_audit_gets_no_monthly_service(db: Database) -> None:
    accepted_order(db)
    sales: str = db.value("select id from public.audits where purpose = 'sales'")

    with pytest.raises(psycopg.errors.InvalidParameterValue, match="Monatsprüfung"):
        _queue(db, sales)


def test_s12_the_app_cannot_queue_the_monthly_service(db: Database) -> None:
    ids = accepted_order(db)
    audit = _monthly_audit(db, ids["customer"])

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.run("select public.queue_monthly_service(%s)", (audit,), ADMIN)


def test_s13_stored_monthly_drafts_send_one_notice_with_the_link_to_decide_them(
    db: Database,
) -> None:
    ids = accepted_order(db)
    finish_optimization(db, ids["order"])
    audit = _monthly_audit(db, ids["customer"])
    job = _queue(db, audit)

    _drafted(db, job, ids["order"], audit, "monthly", 2)
    _drafted(db, job, ids["order"], audit, "monthly", 2)

    notices = [message for message in messages(db) if message["kind"] == "monatsservice"]
    assert len(notices) == 1
    notice = notices[0]
    assert notice["title"] == "Monatsservice: 2 Entwürfe für Bäckerei Korn"
    assert notice["link"] == (
        f"https://app.radarauditor.speedofthespirit.dev/angebot/{audit}?angebot={ids['quote']}"
    )
    assert notice["priority"] == "wichtig"
    assert notice["actions"] == []
    assert "erst nach deiner Freigabe" in notice["body"]


@pytest.mark.parametrize(("purpose", "drafts"), [("sales", 3), ("monthly", 0)])
def test_s13_drafts_of_a_sale_or_an_empty_month_send_no_notice(
    db: Database, purpose: str, drafts: int
) -> None:
    ids = accepted_order(db)
    finish_optimization(db, ids["order"])
    audit = _monthly_audit(db, ids["customer"])

    _drafted(db, _queue(db, audit), ids["order"], audit, purpose, drafts)

    assert not [message for message in messages(db) if message["kind"] == "monatsservice"]


def test_s14_monthly_drafts_on_a_finished_order_never_bill_it_again(db: Database) -> None:
    ids = accepted_order(db)
    finish_optimization(db, ids["order"])
    invoices = db.value("select count(*) from crm.invoices")
    audit = _monthly_audit(db, ids["customer"])
    job = _queue(db, audit)

    db.run("update public.jobs set status = 'running' where id = %s", (job,), SERVICE)
    change: str = db.value(
        "insert into public.optimization_changes (order_id, audit_id, target, after) "
        "values (%s, %s, 'manual:Antwort auf die Bewertung vom 20.09.2026', 'Danke!') returning id",
        (ids["order"], audit),
        SERVICE,
    )
    db.run("update public.jobs set status = 'done' where id = %s", (job,), SERVICE)
    db.run("select public.decide_change(%s, true)", (change,), ADMIN)
    db.run(
        "update public.optimization_changes set status = 'manual_done' where id = %s",
        (change,),
        SERVICE,
    )
    db.run("update public.jobs set status = 'done' where kind = 'apply'", caller=SERVICE)

    assert db.value("select count(*) from public.events where kind = 'optimization.finished'") == 1
    assert db.value("select count(*) from crm.invoices") == invoices


def test_s15_no_monthly_service_while_the_first_optimisation_is_open(db: Database) -> None:
    ids = accepted_order(db)
    customer: str = db.value(
        "select c.id from public.customers c "
        "join crm.orders o on o.customer_id = c.crm_customer_id where o.id = %s",
        (ids["order"],),
    )
    first = db.value(
        "insert into public.jobs (kind, status, customer_id, order_id) "
        "values ('optimize', 'running', %s, %s) returning id",
        (customer, ids["order"]),
        SERVICE,
    )
    db.run(
        "insert into public.optimization_changes (order_id, target, after) "
        "values (%s, 'website', 'neuer Seitentitel')",
        (ids["order"],),
        SERVICE,
    )
    db.run("update public.jobs set status = 'done' where id = %s", (first,), SERVICE)
    audit = _monthly_audit(db, ids["customer"])

    assert _queue(db, audit) is None

    assert db.value("select count(*) from public.jobs where kind = 'optimize'") == 1
    assert db.value("select status::text from public.optimization_changes") == "draft"
    assert db.value("select count(*) from public.events where kind = 'optimization.finished'") == 0
    assert db.value("select count(*) from crm.invoices") == 0
