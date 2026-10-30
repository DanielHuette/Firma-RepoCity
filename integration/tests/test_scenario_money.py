"""Scenarios M1-M10: payments, dunning, monthly invoices, cancellation and the tax adviser package.

Context: Payments are entered by hand in the CRM; the daily routine raises dunning approvals and
monthly invoices; a reminder only goes out after Daniel's tap. | Input: the callers in actors.py
and an accepted order from steps.py. | Output: Assertions on invoices, payments, approvals, outbox,
documents, contracts and Cockpit.
"""

from typing import Any

from actors import render_missing_invoice_pdfs, send_outbox, start_optimization, tap, worker_drafts
from steps import MONTHLY_QUOTED_PRICE, accepted_order

from repocity_integration.database import ADMIN, SERVICE, Database


def _invoiced(db: Database) -> dict[str, Any]:
    ids = accepted_order(db)
    db.run("update crm.subscriptions set next_invoice_date = current_date + 30")
    worker_drafts(db, start_optimization(db, ids["order"]), [])
    send_outbox(db)
    ids["invoice"] = db.value("select id from crm.invoices")
    ids["gross"] = db.value("select gross from crm.invoices")
    return ids


def _days_pass(db: Database, days: int) -> None:
    """Moves the dates that the daily routine compares with today back by some days."""
    db.run(
        "set session_replication_role = replica; "
        f"update crm.invoices set due_date = due_date - {days}, "
        f"last_dunning_at = last_dunning_at - {days}; "
        "set session_replication_role = origin".encode()
    )


def _routine(db: Database) -> None:
    db.run("select crm.daily_routine()", caller=SERVICE)


def _pay(db: Database, invoice: str, amount: float) -> None:
    db.run(
        "select crm.record_payment(p_invoice => %s, p_amount => %s, p_paid_on => current_date, "
        "p_method => 'transfer', p_reference => 'Überweisung')",
        (invoice, amount),
        ADMIN,
    )


def _dunning_mails(db: Database, invoice: str) -> list[tuple[int, str]]:
    return [
        (row["dunning_level"], row["subject"])
        for row in db.rows(
            "select dunning_level, subject from crm.outbox "
            "where kind = 'dunning' and invoice_id = %s "
            "order by created_at",
            (invoice,),
        )
    ]


def test_m1_a_payment_in_full_closes_the_invoice_and_no_reminder_follows(db: Database) -> None:
    ids = _invoiced(db)

    _pay(db, ids["invoice"], ids["gross"])
    _days_pass(db, 30)
    _routine(db)

    assert db.value("select status from crm.invoices where id = %s", (ids["invoice"],)) == "paid"
    assert (
        db.value("select count(*) from crm.approvals where invoice_id = %s", (ids["invoice"],)) == 0
    )
    assert db.value("select count(*) from cockpit.messages where kind = 'zahlung'") == 1


def test_m2_an_overdue_invoice_is_reminded_after_one_tap_and_only_once_a_day(
    db: Database,
) -> None:
    ids = _invoiced(db)
    _days_pass(db, 20)

    _routine(db)
    _routine(db)
    first = tap(db, "freigabe", "approve")
    second = tap(db, "freigabe", "approve")
    send_outbox(db)

    number: str = db.value("select number from crm.invoices where id = %s", (ids["invoice"],))
    assert (first, second["text"]) == (
        {"ok": True, "text": "Freigabe erteilt."},
        "Das wurde bereits erledigt.",
    )
    assert _dunning_mails(db, ids["invoice"]) == [(1, f"Zahlungserinnerung zu Rechnung {number}")]
    assert (
        db.value(
            "select count(*) from crm.documents where kind = 'other' and invoice_id = %s",
            (ids["invoice"],),
        )
        == 1
    )
    _routine(db)
    assert db.value("select count(*) from crm.approvals") == 1


def test_m3_not_sending_pauses_a_week_then_asks_again(db: Database) -> None:
    ids = _invoiced(db)
    _days_pass(db, 20)
    _routine(db)

    assert tap(db, "freigabe", "reject") == {"ok": True, "text": "Freigabe abgelehnt."}
    _routine(db)
    assert db.value("select count(*) from crm.approvals") == 1
    _days_pass(db, 7)
    _routine(db)

    assert _dunning_mails(db, ids["invoice"]) == []
    assert db.value(
        "select array_agg(status order by created_at) from crm.approvals where invoice_id = %s",
        (ids["invoice"],),
    ) == ["rejected", "pending"]


def test_m4_a_payment_after_the_notice_makes_the_send_button_harmless(db: Database) -> None:
    ids = _invoiced(db)
    _days_pass(db, 20)
    _routine(db)

    _pay(db, ids["invoice"], ids["gross"])
    answer = tap(db, "freigabe", "approve")

    assert answer == {"ok": False, "text": "Diese Freigabe ist bereits entschieden."}
    assert _dunning_mails(db, ids["invoice"]) == []


def test_m5_a_part_payment_is_reminded_with_the_rest_and_three_levels_at_most(
    db: Database,
) -> None:
    ids = _invoiced(db)
    _pay(db, ids["invoice"], 71)
    _days_pass(db, 20)

    for _ in range(4):
        _routine(db)
        if db.value("select count(*) from crm.approvals where status = 'pending'"):
            assert tap(db, "freigabe", "approve")["ok"] is True
        _days_pass(db, 7)

    levels = [level for level, _ in _dunning_mails(db, ids["invoice"])]
    assert levels == [1, 2, 3]
    assert "Offen sind 1.000,00 €" in db.value(
        "select body from crm.outbox where kind = 'dunning' and dunning_level = 1 "
        "and invoice_id = %s",
        (ids["invoice"],),
    )


def test_m6_the_monthly_invoice_goes_out_once_even_when_the_routine_runs_twice(
    db: Database,
) -> None:
    accepted_order(db)
    send_outbox(db)

    _routine(db)
    _routine(db)
    sent = send_outbox(db)

    invoice = db.one("select number, status, net from crm.invoices")
    assert (invoice["status"], invoice["net"]) == ("open", MONTHLY_QUOTED_PRICE)
    assert sent == [f"Rechnung {invoice['number']}"]
    db.run("update crm.subscriptions set next_invoice_date = current_date")
    _routine(db)
    assert db.value("select count(*) from crm.invoices") == 2


def test_m7_a_monthly_invoice_without_company_data_waits_for_daniel(db: Database) -> None:
    accepted_order(db)
    db.run("update crm.settings set company_name = ''", caller=ADMIN)

    _routine(db)
    db.run("update crm.settings set company_name = 'RepoCity'", caller=ADMIN)
    invoice: str = db.value("select id from crm.invoices where status = 'draft'")
    db.run("select crm.send_invoice(p_invoice => %s)", (invoice,), ADMIN)

    assert db.value("select status from crm.invoices") == "open"
    assert db.value("select count(*) from crm.outbox where kind = 'invoice'") == 1
    assert db.value("select count(*) from cockpit.messages where kind = 'rechnung-offen'") == 1


def test_m8_a_cancelled_subscription_bills_up_to_its_end_and_then_stops(db: Database) -> None:
    ids = accepted_order(db)
    subscription: str = db.value("select id from crm.subscriptions")
    _routine(db)

    db.run(
        "select crm.cancel_subscription(p_subscription => %s, p_end => current_date + 20)",
        (subscription,),
        ADMIN,
    )
    db.run(
        "update crm.subscriptions set next_invoice_date = current_date, "
        "next_audit_date = current_date, end_date = current_date - 1"
    )
    _routine(db)

    assert (
        db.value("select count(*) from crm.invoices where customer_id = %s", (ids["customer"],))
        == 1
    )
    assert db.value("select active from crm.subscriptions") is False
    assert db.value("select count(*) from crm.audit_runs") == 0
    assert db.value("select status from crm.contracts where template_key = 'maintenance'") == (
        "ended"
    )


def test_m9_a_cancelled_invoice_and_its_credit_note_reach_the_tax_adviser_package(
    db: Database,
) -> None:
    ids = _invoiced(db)
    db.run("update crm.subscriptions set next_invoice_date = current_date")
    _routine(db)
    send_outbox(db)
    monthly: str = db.value("select id from crm.invoices where order_id is null")
    _pay(db, monthly, db.value("select gross from crm.invoices where id = %s", (monthly,)))
    db.run("select crm.cancel_invoice(p_invoice => %s)", (ids["invoice"],), ADMIN)

    render_missing_invoice_pdfs(db)
    period = db.rows(
        "select i.id, i.status, i.cancels_invoice_id is not null as credit_note "
        "from crm.invoices i "
        "where i.status <> 'draft' and i.issue_date between date_trunc('month', current_date) "
        "and current_date order by i.number",
        caller=ADMIN,
    )
    pdfs = db.value(
        "select count(distinct invoice_id) from crm.documents where kind = 'invoice'", caller=ADMIN
    )
    payments = db.rows(
        "select p.amount, i.number from crm.payments p join crm.invoices i "
        "on i.id = p.invoice_id where p.paid_on >= date_trunc('month', current_date)",
        caller=ADMIN,
    )

    assert sorted((row["status"], row["credit_note"]) for row in period) == [
        ("cancelled", False),
        ("paid", False),
        ("paid", True),
    ]
    assert pdfs == 3
    assert len(payments) == 1
    assert render_missing_invoice_pdfs(db) == 0


def test_m10_an_invoice_mail_without_address_becomes_a_task(db: Database) -> None:
    ids = accepted_order(db)
    db.run("update crm.customers set email = null where id = %s", (ids["customer"],), ADMIN)

    worker_drafts(db, start_optimization(db, ids["order"]), [])

    assert db.value("select status from crm.invoices") == "draft"
    assert "E-Mail-Adresse" in db.value("select title from crm.tasks where invoice_id is not null")
    assert db.value("select count(*) from crm.review_requests") == 1
