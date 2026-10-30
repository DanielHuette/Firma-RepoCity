"""Scenarios O1-O9: the optimisation of an accepted order ends and the order is invoiced once.

Context: The RadarAuditor app starts the optimisation, Daniel decides the drafts, the worker
applies them; when nothing is left open the event optimization.finished completes the order in the
CRM, or Daniel completes it by hand. | Input: the callers in actors.py and an accepted order from
steps.py. | Output: Assertions on changes, events, orders, invoices, outbox, documents, review
requests and Cockpit.
"""

from typing import Any

from actors import (
    decide_change,
    mark_manual_done,
    send_outbox,
    start_optimization,
    worker_applies,
    worker_drafts,
)
from steps import ONCE_PRICE, accepted_order, titles

from repocity_integration.database import ADMIN, SERVICE, Database


def _drafted(db: Database, targets: list[str]) -> tuple[dict[str, Any], list[str]]:
    ids = accepted_order(db)
    send_outbox(db)
    job = start_optimization(db, ids["order"])
    return ids, worker_drafts(db, job, targets)


def _assert_invoiced_once(db: Database, order: str) -> None:
    invoice = db.one(
        "select id, number, status, net from crm.invoices where order_id = %s", (order,)
    )
    assert (invoice["status"], invoice["net"]) == ("open", ONCE_PRICE)
    assert db.value("select status from crm.orders where id = %s", (order,)) == "invoiced"
    assert db.value("select count(*) from crm.outbox where kind = 'invoice'") == 1
    assert db.value("select count(*) from crm.review_requests where order_id = %s", (order,)) == 1
    assert db.value("select count(*) from public.events where kind = 'optimization.finished'") <= 1
    assert db.value("select count(*) from cockpit.messages where kind = 'auftrag-fehler'") == 0


def test_o1_approved_changes_applied_complete_and_invoice_the_order(db: Database) -> None:
    ids, drafts = _drafted(db, ["website", "google_profile"])
    for change in drafts:
        decide_change(db, change, True)
    assert db.value("select count(*) from crm.invoices") == 0

    worker_applies(db, dict.fromkeys(drafts, "applied"))
    sent = send_outbox(db)

    _assert_invoiced_once(db, ids["order"])
    number: str = db.value("select number from crm.invoices")
    assert sent == [f"Rechnung {number}"]
    assert db.value("select count(*) from crm.documents where kind = 'invoice'") == 1
    assert f"Mail verschickt: Rechnung {number}" in titles(db)


def test_o2_an_optimisation_that_finds_nothing_to_change_completes_the_order(
    db: Database,
) -> None:
    ids, drafts = _drafted(db, [])

    assert drafts == []
    _assert_invoiced_once(db, ids["order"])


def test_o3_a_failed_change_keeps_the_order_open_until_daniel_completes_it(db: Database) -> None:
    ids, drafts = _drafted(db, ["website", "google_profile"])
    for change in drafts:
        decide_change(db, change, True)
    worker_applies(db, {drafts[0]: "applied", drafts[1]: "failed"})
    assert db.value("select count(*) from crm.invoices") == 0

    db.run("select crm.complete_order(p_order => %s)", (ids["order"],), ADMIN)
    retry = start_optimization(db, ids["order"])
    worker_drafts(db, retry, [])

    _assert_invoiced_once(db, ids["order"])


def test_o4_a_change_done_by_hand_completes_the_order_when_ticked_off(db: Database) -> None:
    ids, drafts = _drafted(db, ["schema"])
    decide_change(db, drafts[0], True)
    worker_applies(db, {drafts[0]: "manual"})
    assert db.value("select count(*) from crm.invoices") == 0

    mark_manual_done(db, drafts[0])

    _assert_invoiced_once(db, ids["order"])


def test_o5_rejecting_every_draft_completes_the_order(db: Database) -> None:
    ids, drafts = _drafted(db, ["website"])

    decide_change(db, drafts[0], False)

    _assert_invoiced_once(db, ids["order"])


def test_o6_missing_company_data_leaves_a_draft_daniel_sends_after_filling_it_in(
    db: Database,
) -> None:
    ids, drafts = _drafted(db, ["website"])
    db.run("update crm.settings set tax_number = ''", caller=ADMIN)
    decide_change(db, drafts[0], True)
    worker_applies(db, {drafts[0]: "applied"})

    invoice: str = db.value("select id from crm.invoices where status = 'draft'")
    assert db.value("select title from cockpit.messages where kind = 'rechnung-offen'") == (
        "Rechnung nicht verschickt: Bäckerei Korn"
    )
    db.run("update crm.settings set tax_number = '337/5000/0000'", caller=ADMIN)
    db.run("select crm.send_invoice(p_invoice => %s)", (invoice,), ADMIN)
    send_outbox(db)

    _assert_invoiced_once(db, ids["order"])
    assert (
        db.value("select count(*) from crm.outbox where kind = 'invoice' and status = 'sent'") == 1
    )


def test_o7_a_retried_apply_job_writes_the_event_and_the_invoice_once(db: Database) -> None:
    ids, drafts = _drafted(db, ["website"])
    decide_change(db, drafts[0], True)
    worker_applies(db, {drafts[0]: "applied"})

    db.run("update public.jobs set status = 'queued' where kind = 'apply'", caller=SERVICE)
    db.run("update public.jobs set status = 'done' where kind = 'apply'", caller=SERVICE)
    db.run("update public.optimization_changes set status = 'applied'", caller=SERVICE)

    _assert_invoiced_once(db, ids["order"])
    assert db.value("select count(*) from public.events where kind = 'optimization.finished'") == 1


def test_o8_completing_by_hand_twice_or_after_the_event_changes_nothing(db: Database) -> None:
    ids, _ = _drafted(db, [])

    db.run("select crm.complete_order(p_order => %s)", (ids["order"],), ADMIN)
    db.run("select crm.complete_order(p_order => %s)", (ids["order"],), ADMIN)

    _assert_invoiced_once(db, ids["order"])


def test_o9_an_order_of_monthly_items_only_is_done_without_invoice(db: Database) -> None:
    ids = accepted_order(db)
    db.run("delete from crm.invoices")
    db.run(
        "set session_replication_role = replica; "
        "delete from crm.quote_items where product_id <> "
        "(select id from crm.products where billing = 'monthly'); "
        "set session_replication_role = origin"
    )

    worker_drafts(db, start_optimization(db, ids["order"]), [])

    assert db.value("select status from crm.orders") == "done"
    assert db.value("select count(*) from crm.invoices") == 0
    assert db.value("select count(*) from crm.review_requests") == 1
