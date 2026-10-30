"""Scenarios S1-S9: the monthly service after the order, run by the daily routine.

Context: The cron job crm-daily calls crm.daily_routine once a day; it may run twice when the server
restarts. Monthly audits are started by one tap in the Cockpit or in the CRM and reported by the
RadarAuditor worker; review requests follow the completed order. | Input: the callers in actors.py
and an accepted order from steps.py. | Output: Assertions on audit runs, audits, review requests,
outbox and Cockpit.
"""

from typing import Any

from actors import report_audit, send_outbox, start_optimization, tap, worker_drafts
from steps import accepted_order

from repocity_integration.database import ADMIN, SERVICE, Database

LINK = "https://g.page/r/baeckerei-korn/review"


def _routine(db: Database) -> None:
    db.run("select crm.daily_routine()", caller=SERVICE)


def _audit_due(db: Database) -> dict[str, Any]:
    ids = accepted_order(db)
    db.run("update crm.subscriptions set next_audit_date = current_date")
    _routine(db)
    return ids


def _monthly_audit(db: Database) -> str:
    audit: str = db.value("select audit_id from crm.audit_runs")
    return audit


def _completed(db: Database) -> dict[str, Any]:
    ids = accepted_order(db)
    worker_drafts(db, start_optimization(db, ids["order"]), [])
    send_outbox(db)
    return ids


def _review_mails(db: Database) -> list[str]:
    return [
        row["kind"]
        for row in db.rows(
            "select kind from crm.outbox where kind like 'review%%' order by created_at"
        )
    ]


def test_s1_one_tap_on_the_lock_screen_runs_and_reports_the_monthly_audit(db: Database) -> None:
    ids = _audit_due(db)
    db.run("update public.audits set status = 'reported', total_score = 61.5")

    assert tap(db, "pruefung-faellig", "start_audit") == {"ok": True, "text": "Prüfung gestartet."}
    report_audit(db, _monthly_audit(db), "reported", 74.25)
    report_audit(db, _monthly_audit(db), "reported", 74.25)

    assert db.one("select status, score_before, score_after from crm.audit_runs") == {
        "status": "reported",
        "score_before": 61.5,
        "score_after": 74.25,
    }
    assert db.value("select purpose from public.audits where id = %s", (_monthly_audit(db),)) == (
        "monthly"
    )
    assert db.value("select body from cockpit.messages where kind = 'pruefung-fertig'") == (
        "Punkte vorher 61,5, jetzt 74,25"
    )
    assert (
        db.value(
            "select count(*) from crm.activities where customer_id = %s and body = "
            "'Monatsprüfung abgeschlossen: 74,25 Punkte.'",
            (ids["customer"],),
        )
        == 1
    )


def test_s2_started_in_the_crm_the_old_lock_screen_button_only_explains(db: Database) -> None:
    _audit_due(db)
    run: str = db.value("select id from crm.audit_runs")

    db.run("select crm.start_audit_run(p_run => %s)", (run,), ADMIN)
    answer = tap(db, "pruefung-faellig", "start_audit")

    assert answer == {"ok": False, "text": "Diese Monatsprüfung läuft schon oder ist fertig."}
    assert db.value("select count(*) from public.audits where purpose = 'monthly'") == 1


def test_s3_a_failed_monthly_audit_is_started_again_from_its_own_notice(db: Database) -> None:
    _audit_due(db)
    tap(db, "pruefung-faellig", "start_audit")
    report_audit(db, _monthly_audit(db), "failed", None)

    assert tap(db, "pruefung-fehlgeschlagen", "start_audit")["ok"] is True
    report_audit(db, _monthly_audit(db), "reported", 70)

    assert db.value("select status from crm.audit_runs") == "reported"
    assert db.value("select count(*) from public.audits where purpose = 'monthly'") == 2
    assert db.value("select count(*) from cockpit.messages where kind = 'pruefung-fertig'") == 1


def test_s4_the_daily_routine_twice_on_one_day_doubles_nothing(db: Database) -> None:
    _completed(db)
    db.run("update crm.settings set google_review_url = %s", (LINK,))
    db.run("update crm.subscriptions set next_audit_date = current_date")
    db.run(
        "set session_replication_role = replica; "
        "update crm.invoices set due_date = current_date - 20; "
        "set session_replication_role = origin"
    )
    before = db.value("select count(*) from cockpit.messages")

    _routine(db)
    after_first = db.value("select count(*) from cockpit.messages")
    counts = db.one(
        "select (select count(*) from crm.invoices) as invoices, "
        "(select count(*) from crm.outbox) as mails, "
        "(select count(*) from crm.approvals) as approvals, "
        "(select count(*) from crm.audit_runs) as runs"
    )
    _routine(db)

    assert after_first > before
    assert db.value("select count(*) from cockpit.messages") == after_first
    assert (
        db.one(
            "select (select count(*) from crm.invoices) as invoices, "
            "(select count(*) from crm.outbox) as mails, "
            "(select count(*) from crm.approvals) as approvals, "
            "(select count(*) from crm.audit_runs) as runs"
        )
        == counts
    )
    assert counts["runs"] == 1 and counts["approvals"] >= 1


def test_s5_without_a_link_the_request_waits_then_goes_out_once_and_is_reminded_once(
    db: Database,
) -> None:
    _completed(db)

    _routine(db)
    _routine(db)
    assert db.value("select status from crm.review_requests") == "waiting_link"
    assert (
        db.value("select count(*) from cockpit.messages where kind = 'bewertungslink-fehlt'") == 1
    )
    db.run("update crm.settings set google_review_url = %s", (LINK,), ADMIN)
    _routine(db)
    db.run("update crm.review_requests set reminder_due = current_date")
    _routine(db)
    _routine(db)
    sent = send_outbox(db)

    assert _review_mails(db) == ["review_request", "review_reminder"]
    assert [subject for subject in sent if "Bewertung" in subject] == [
        "Bitte um eine Bewertung",
        "Erinnerung: Bitte um eine Bewertung",
    ]
    assert db.value("select status from crm.review_requests") == "reminded"


def test_s6_a_customer_who_objected_gets_no_review_mail(db: Database) -> None:
    ids = _completed(db)
    db.run(
        "update crm.customers set no_review_requests = true where id = %s",
        (ids["customer"],),
        ADMIN,
    )
    db.run("update crm.settings set google_review_url = %s", (LINK,), ADMIN)

    _routine(db)

    assert _review_mails(db) == []
    assert db.value("select status from crm.review_requests") == "cancelled"


def test_s7_an_objection_after_the_request_stops_the_reminder(db: Database) -> None:
    ids = _completed(db)
    db.run("update crm.settings set google_review_url = %s", (LINK,), ADMIN)
    _routine(db)

    db.run(
        "update crm.customers set no_review_requests = true where id = %s",
        (ids["customer"],),
        ADMIN,
    )
    db.run("update crm.review_requests set reminder_due = current_date")
    _routine(db)

    assert _review_mails(db) == ["review_request"]
    assert db.value("select status from crm.review_requests") == "cancelled"


def test_s8_a_request_ticked_off_by_daniel_gets_no_reminder(db: Database) -> None:
    _completed(db)
    db.run("update crm.settings set google_review_url = %s", (LINK,), ADMIN)
    _routine(db)
    request: str = db.value("select id from crm.review_requests")

    db.run("select crm.mark_review_done(p_request => %s)", (request,), ADMIN)
    db.run("update crm.review_requests set reminder_due = current_date")
    _routine(db)

    assert _review_mails(db) == ["review_request"]
    assert db.value("select status from crm.review_requests") == "done"


def test_s9_a_failing_step_is_reported_once_a_day_and_the_others_still_run(
    db: Database,
) -> None:
    accepted_order(db)
    db.run("update crm.subscriptions set next_audit_date = current_date")
    db.run(
        "create function crm.break_reviews() returns trigger language plpgsql as "
        "$$ begin raise exception 'kaputt'; end $$; "
        "create trigger break_reviews before update on crm.review_requests "
        "for each row execute function crm.break_reviews(); "
        "insert into crm.review_requests (customer_id, order_id) "
        "select customer_id, id from crm.orders"
    )

    _routine(db)
    _routine(db)

    assert db.value("select count(*) from crm.audit_runs") == 1
    assert db.value("select count(*) from crm.invoices where status = 'open'") == 1
    assert db.value("select array_agg(title) from cockpit.messages where kind = 'tagesablauf'") == [
        "Tagesablauf: Bewertungsanfragen fehlgeschlagen"
    ]


def test_s10_once_the_link_is_set_no_request_keeps_reporting_it_missing(db: Database) -> None:
    ids = _completed(db)
    db.run("update crm.customers set email = null where id = %s", (ids["customer"],), ADMIN)
    _routine(db)
    assert db.value("select status from crm.review_requests") == "waiting_link"

    db.run("update crm.settings set google_review_url = %s", (LINK,), ADMIN)
    _routine(db)
    db.run("delete from cockpit.messages where kind = 'bewertungslink-fehlt'")
    db.run("select cockpit.check_health()", caller=SERVICE)

    assert (
        db.value("select count(*) from cockpit.messages where kind = 'bewertungslink-fehlt'") == 0
    )
    db.run(
        "update crm.customers set email = 'info@baeckerei-korn.de' where id = %s",
        (ids["customer"],),
        ADMIN,
    )
    _routine(db)
    assert _review_mails(db) == ["review_request"]
