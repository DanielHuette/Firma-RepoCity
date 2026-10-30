"""Steps 7 and 11 of the flow: monthly invoices and dunning, and the daily routine that runs them.

Context: The cron job crm-daily calls crm.daily_routine with the service key. | Input: an accepted
order with one subscription. | Output: Assertions on invoices, approvals, outbox and Cockpit.
"""

from typing import Any

import psycopg
import pytest
from steps import MONTHLY_QUOTED_PRICE, accepted_order, outbox

from repocity_integration.database import ADMIN, ANON, SERVICE, Database


def test_bill_subscriptions_finalises_and_sends_at_the_quoted_price(db: Database) -> None:
    accepted_order(db)

    assert db.value("select crm.bill_subscriptions()", caller=SERVICE) == 1

    invoice = db.one("select id, number, status, net from crm.invoices")
    assert (invoice["status"], invoice["net"]) == ("open", MONTHLY_QUOTED_PRICE)
    assert [(m["kind"], m["invoice_id"]) for m in outbox(db) if m["kind"] == "invoice"] == [
        ("invoice", invoice["id"])
    ]
    assert db.value(
        "select next_invoice_date = (current_date + interval '1 month')::date "
        "from crm.subscriptions"
    )
    assert db.value("select crm.bill_subscriptions()", caller=SERVICE) == 0


def test_a_monthly_invoice_states_its_service_period(db: Database) -> None:
    accepted_order(db)

    db.run("select crm.bill_subscriptions()", caller=SERVICE)

    assert db.one(
        "select service_date = current_date as starts_today, service_period_end = "
        "(current_date + interval '1 month' - interval '1 day')::date as ends_a_month_later "
        "from crm.invoices"
    ) == {"starts_today": True, "ends_a_month_later": True}
    with pytest.raises(psycopg.Error, match="festgeschrieben"):
        db.run("update crm.invoices set service_period_end = null", caller=ADMIN)


def test_billing_without_company_data_leaves_the_draft_and_a_task(db: Database) -> None:
    accepted_order(db)
    db.run("update crm.settings set company_name = ''")

    assert db.value("select crm.bill_subscriptions()", caller=SERVICE) == 1

    assert db.value("select status from crm.invoices") == "draft"
    assert db.value("select count(*) from crm.tasks where invoice_id is not null and not done") == 1


def _overdue_invoice(db: Database) -> dict[str, Any]:
    accepted_order(db)
    db.run("select crm.bill_subscriptions()", caller=SERVICE)
    db.run(
        "set session_replication_role = replica; "
        "update crm.invoices set due_date = current_date - 20; "
        "set session_replication_role = origin"
    )
    db.run("select crm.run_dunning()", caller=SERVICE)
    approval: dict[str, Any] = db.one("select id, title, invoice_id from crm.approvals")
    return approval


def test_dunning_waits_for_a_tap_with_send_and_do_not_send(db: Database) -> None:
    approval = _overdue_invoice(db)

    notice = db.one(
        "select title, actions, action_payload from cockpit.messages where kind = 'freigabe'"
    )
    assert notice["title"] == f"Freigabe nötig: {approval['title']}"
    assert notice["actions"] == [
        {"action": "approve", "title": "Senden"},
        {"action": "reject", "title": "Nicht senden"},
    ]
    assert notice["action_payload"] == {"approval_id": str(approval["id"])}
    assert [m for m in outbox(db) if m["kind"] == "dunning"] == []


def test_approving_the_dunning_queues_the_reminder_mail(db: Database) -> None:
    approval = _overdue_invoice(db)

    db.run("select crm.decide_approval(%s, true)", (approval["id"],), ADMIN)

    number = db.value("select number from crm.invoices")
    mails = [m for m in outbox(db) if m["kind"] == "dunning"]
    assert [
        (m["invoice_id"], m["dunning_level"], m["approval_id"], m["subject"]) for m in mails
    ] == [(approval["invoice_id"], 1, approval["id"], f"Zahlungserinnerung zu Rechnung {number}")]
    assert "Offen sind 94,01 €" in mails[0]["body"]
    assert db.value("select dunning_level from crm.invoices") == 1


def test_the_send_button_on_the_lock_screen_queues_the_reminder(db: Database) -> None:
    _overdue_invoice(db)
    notice = db.one("select id, action_token from cockpit.messages where kind = 'freigabe'")

    answer = db.value(
        "select cockpit.run_action(%s, %s, 'approve')",
        (notice["id"], notice["action_token"]),
        ANON,
    )

    assert answer == {"ok": True, "text": "Freigabe erteilt."}
    assert [m["dunning_level"] for m in outbox(db) if m["kind"] == "dunning"] == [1]


def test_not_sending_records_the_decision_without_mail(db: Database) -> None:
    _overdue_invoice(db)
    notice = db.one("select id, action_token from cockpit.messages where kind = 'freigabe'")

    answer = db.value(
        "select cockpit.run_action(%s, %s, 'reject')",
        (notice["id"], notice["action_token"]),
        ANON,
    )

    assert answer == {"ok": True, "text": "Freigabe abgelehnt."}
    assert db.value("select status from crm.approvals") == "rejected"
    assert [m for m in outbox(db) if m["kind"] == "dunning"] == []


def test_a_rejected_dunning_pauses_seven_days_like_a_sent_one(db: Database) -> None:
    approval = _overdue_invoice(db)

    db.run("select crm.decide_approval(%s, false)", (approval["id"],), ADMIN)

    assert db.value("select crm.run_dunning()", caller=SERVICE) == 0
    db.run(
        "set session_replication_role = replica; "
        "update crm.invoices set last_dunning_at = current_date - 7; "
        "set session_replication_role = origin"
    )
    assert db.value("select crm.run_dunning()", caller=SERVICE) == 1
    assert db.value("select dunning_level from crm.invoices") == 0


def test_daily_routine_runs_every_step_with_the_service_key(db: Database) -> None:
    accepted_order(db)
    db.run("update crm.subscriptions set next_audit_date = current_date")

    db.run("select crm.daily_routine()", caller=SERVICE)

    assert db.value("select count(*) from crm.invoices where status = 'open'") == 1
    assert db.value("select count(*) from crm.audit_runs") == 1


def test_a_failing_step_does_not_stop_the_others(db: Database) -> None:
    accepted_order(db)
    db.run("update crm.subscriptions set next_audit_date = current_date")
    db.run(
        "create function crm.break_dunning() returns trigger language plpgsql as "
        "$$ begin raise exception 'kaputt'; end $$; "
        "create trigger break_dunning before insert on crm.approvals "
        "for each row execute function crm.break_dunning(); "
        "set session_replication_role = replica; "
        "insert into crm.invoices (customer_id, number, status, gross, due_date) "
        "select id, 'RE-ALT', 'open', 10, current_date - 30 from crm.customers limit 1; "
        "set session_replication_role = origin"
    )

    db.run("select crm.daily_routine()", caller=SERVICE)

    assert db.value("select count(*) from crm.audit_runs") == 1
    assert (
        db.value("select title from cockpit.messages where kind = 'tagesablauf'")
        == "Tagesablauf: Mahnwesen fehlgeschlagen"
    )


def test_the_cron_job_calls_the_daily_routine(db: Database) -> None:
    assert db.value("select command from cron.job where jobname = 'crm-daily'") == (
        " select crm.daily_routine(); "
    )
