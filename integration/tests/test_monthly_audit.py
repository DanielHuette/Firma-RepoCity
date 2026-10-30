"""Steps 8 to 10 of the flow: monthly audit due, started by one tap, reported or failed.

Context: The daily routine flags due audits, the Cockpit button runs crm.start_audit_run through
cockpit.run_action, the RadarAuditor worker reports the audit. | Input: an accepted order whose
subscription covers a catalogue area. | Output: Assertions on audit runs, audits, jobs and Cockpit.
"""

from typing import Any

import pytest
from steps import accepted_order, titles

from repocity_integration.database import ADMIN, ANON, READER, SERVICE, Database


def _due_run(db: Database) -> dict[str, Any]:
    ids = accepted_order(db)
    db.run("update crm.subscriptions set next_audit_date = current_date")
    assert db.value("select crm.flag_due_audits()", caller=SERVICE) == 1
    ids["run"] = db.value("select id from crm.audit_runs")
    ids["notice"] = db.one(
        "select id, action_token from cockpit.messages where kind = 'pruefung-faellig'"
    )
    return ids


def _tap(db: Database, notice: dict[str, Any], action: str = "start_audit") -> Any:
    return db.value(
        "select cockpit.run_action(%s, %s, %s)",
        (notice["id"], notice["action_token"], action),
        ANON,
    )


def test_a_due_subscription_gets_one_run_per_month(db: Database) -> None:
    ids = _due_run(db)

    assert db.one(
        "select subscription_id is not null as linked, customer_id, status, month "
        "= date_trunc('month', current_date)::date as this_month from crm.audit_runs"
    ) == {"linked": True, "customer_id": ids["customer"], "status": "due", "this_month": True}
    assert db.value(
        "select next_audit_date = (current_date + interval '1 month')::date from crm.subscriptions"
    )
    assert db.value("select crm.flag_due_audits()", caller=SERVICE) == 0


def test_the_due_run_is_announced_with_the_start_button(db: Database) -> None:
    ids = _due_run(db)

    notice = db.one(
        "select title, actions, action_payload, tag from cockpit.messages "
        "where kind = 'pruefung-faellig'"
    )
    assert notice == {
        "title": "Monatsprüfung fällig: Bäckerei Korn",
        "actions": [{"action": "start_audit", "title": "Prüfung auslösen"}],
        "action_payload": {"run_id": str(ids["run"])},
        "tag": None,
    }


def test_one_tap_starts_a_monthly_audit_in_the_radarauditor(db: Database) -> None:
    ids = _due_run(db)

    assert _tap(db, ids["notice"]) == {"ok": True, "text": "Prüfung gestartet."}

    run = db.one("select status, audit_id, started_at is not null as started from crm.audit_runs")
    assert (run["status"], run["started"]) == ("started", True)
    assert db.one(
        "select a.purpose, a.status, j.kind as job from public.audits a "
        "join public.jobs j on j.audit_id = a.id where a.id = %s",
        (run["audit_id"],),
    ) == {"purpose": "monthly", "status": "requested", "job": "collect"}
    assert "Prüfung gestartet: Bäckerei Korn" in titles(db)
    assert db.one(
        "select acted_action, action_result from cockpit.messages where id = %s",
        (ids["notice"]["id"],),
    ) == {"acted_action": "start_audit", "action_result": "Prüfung gestartet."}


def test_a_second_tap_is_refused(db: Database) -> None:
    ids = _due_run(db)
    _tap(db, ids["notice"])

    assert _tap(db, ids["notice"]) == {"ok": False, "text": "Das wurde bereits erledigt."}
    assert db.value("select count(*) from public.audits where purpose = 'monthly'") == 1


def test_a_wrong_token_is_refused(db: Database) -> None:
    ids = _due_run(db)
    forged = {"id": ids["notice"]["id"], "action_token": db.value("select gen_random_uuid()")}

    assert _tap(db, forged) == {"ok": False, "text": "Diese Aktion ist nicht gültig."}
    assert db.value("select status from crm.audit_runs") == "due"


def test_an_action_the_notice_does_not_offer_is_refused(db: Database) -> None:
    ids = _due_run(db)

    assert _tap(db, ids["notice"], "accept_quote") == {
        "ok": False,
        "text": "Diese Aktion gibt es hier nicht.",
    }
    assert _tap(db, ids["notice"], "drop_everything")["ok"] is False


def test_a_notice_older_than_14_days_is_refused(db: Database) -> None:
    ids = _due_run(db)
    db.run(
        "update cockpit.messages set created_at = now() - interval '15 days' where id = %s",
        (ids["notice"]["id"],),
    )

    assert _tap(db, ids["notice"]) == {
        "ok": False,
        "text": "Diese Mitteilung ist älter als 14 Tage. Bitte im CRM erledigen.",
    }


def test_a_failing_action_answers_with_the_reason_and_can_be_tried_again(db: Database) -> None:
    ids = _due_run(db)
    db.run("update public.customers set crm_customer_id = null")

    assert _tap(db, ids["notice"]) == {
        "ok": False,
        "text": "Zu diesem Kunden gibt es noch keine Prüfung.",
    }
    assert (
        db.value("select acted_at from cockpit.messages where id = %s", (ids["notice"]["id"],))
        is None
    )


def test_start_audit_run_is_for_the_administrator(db: Database) -> None:
    ids = _due_run(db)

    with pytest.raises(Exception, match="Nur der Administrator darf das."):
        db.run("select crm.start_audit_run(%s)", (ids["run"],), READER)
    db.run("select crm.start_audit_run(%s)", (ids["run"],), ADMIN)
    with pytest.raises(Exception, match="läuft schon oder ist fertig"):
        db.run("select crm.start_audit_run(%s)", (ids["run"],), ADMIN)


def _report(db: Database, status: str, score: int | None) -> dict[str, Any]:
    ids = _due_run(db)
    db.run("update public.audits set total_score = 55 where purpose = 'sales'")
    db.run("update public.audits set status = 'reported' where purpose = 'sales'", caller=SERVICE)
    _tap(db, ids["notice"])
    db.run(
        "update public.audits set status = %s, total_score = %s where purpose = 'monthly'",
        (status, score),
        SERVICE,
    )
    return ids


def test_a_reported_audit_closes_the_run_with_both_scores(db: Database) -> None:
    ids = _report(db, "reported", 72)

    assert db.one(
        "select status, score_before, score_after, finished_at is not null as done "
        "from crm.audit_runs"
    ) == {"status": "reported", "score_before": 55, "score_after": 72, "done": True}
    assert "Monatsprüfung fertig: Bäckerei Korn" in titles(db)
    assert (
        db.value(
            "select count(*) from crm.activities where customer_id = %s and body = %s",
            (ids["customer"], "Monatsprüfung abgeschlossen: 72 Punkte."),
        )
        == 1
    )


def test_a_failed_audit_marks_the_run_and_offers_a_new_start(db: Database) -> None:
    _report(db, "failed", None)

    assert db.value("select status from crm.audit_runs") == "failed"
    notice = db.one(
        "select id, action_token, priority, actions from cockpit.messages "
        "where title = 'Monatsprüfung fehlgeschlagen: Bäckerei Korn'"
    )
    assert notice["priority"] == "dringend"
    assert notice["actions"] == [{"action": "start_audit", "title": "Erneut auslösen"}]
    assert _tap(db, notice)["ok"] is True
    assert db.value("select status from crm.audit_runs") == "started"


def test_every_finished_audit_of_a_linked_customer_lands_in_the_customer_file(
    db: Database,
) -> None:
    ids = accepted_order(db)

    db.run("update public.audits set status = 'reported', total_score = 61.5", caller=SERVICE)

    assert (
        db.value(
            "select count(*) from crm.activities where customer_id = %s and body = %s",
            (ids["customer"], "Prüfung abgeschlossen: 61,5 Punkte."),
        )
        == 1
    )


@pytest.mark.parametrize(("areas", "audited"), [("{a}", True), ("{}", False)])
def test_a_subscription_made_in_the_crm_is_audited_when_its_product_covers_an_area(
    db: Database, areas: str, audited: bool
) -> None:
    customer = db.value("insert into crm.customers (name) values ('Handwerk') returning id")
    product = db.value(
        "insert into crm.products (name, price_net, billing, radar_areas) "
        "values ('Pflege', 50, 'monthly', %s::text[]) returning id",
        (areas,),
    )

    due = db.value(
        "insert into crm.subscriptions (customer_id, product_id, start_date) "
        "values (%s, %s, date '2026-11-15') returning next_audit_date",
        (customer, product),
        ADMIN,
    )

    assert (due is not None, str(due)) == (audited, "2026-12-15" if audited else "None")
