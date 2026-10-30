"""Step 6 of the flow: review request after the order, one reminder, then nothing more.

Context: crm.run_review_requests runs in the daily routine; the Google review link is set in the CRM
settings. | Input: a completed order. | Output: Assertions on review requests, outbox and Cockpit.
"""

from steps import accepted_order, finish_optimization, outbox

from repocity_integration.database import ADMIN, SERVICE, Database

LINK = "https://g.page/r/baeckerei-korn/review"


def _completed(db: Database) -> str:
    ids = accepted_order(db)
    finish_optimization(db, ids["order"])
    request: str = db.value("select id from crm.review_requests")
    return request


def _reviews(db: Database) -> list[tuple[str, str]]:
    return [(m["kind"], m["body"]) for m in outbox(db) if m["kind"].startswith("review")]


def test_without_link_the_request_waits_with_one_notice_per_day(db: Database) -> None:
    _completed(db)

    db.run("select crm.run_review_requests()", caller=SERVICE)
    db.run("select crm.run_review_requests()", caller=SERVICE)
    db.run("select cockpit.check_health()", caller=SERVICE)

    assert db.value("select status from crm.review_requests") == "waiting_link"
    assert _reviews(db) == []
    assert db.rows(
        "select title, link from cockpit.messages where kind = 'bewertungslink-fehlt'"
    ) == [
        {
            "title": "Link zur Google-Bewertung fehlt",
            "link": "https://crm.speedofthespirit.dev/einstellungen",
        }
    ]


def test_with_link_the_request_is_sent_once_then_reminded_once(db: Database) -> None:
    _completed(db)
    db.run("select crm.run_review_requests()", caller=SERVICE)
    db.run("update crm.settings set google_review_url = %s", (LINK,))

    assert db.value("select crm.run_review_requests()", caller=SERVICE) == 1
    assert db.one(
        "select status, reminder_due = current_date + 7 as in_a_week from crm.review_requests"
    ) == {"status": "sent", "in_a_week": True}
    assert db.value("select crm.run_review_requests()", caller=SERVICE) == 0

    db.run("update crm.review_requests set reminder_due = current_date")
    assert db.value("select crm.run_review_requests()", caller=SERVICE) == 1
    db.run("update crm.review_requests set reminder_due = current_date - 30")
    assert db.value("select crm.run_review_requests()", caller=SERVICE) == 0

    sent = _reviews(db)
    assert [kind for kind, _ in sent] == ["review_request", "review_reminder"]
    assert all(LINK in body for _, body in sent)
    assert db.value("select status from crm.review_requests") == "reminded"


def test_a_request_marked_done_gets_no_reminder(db: Database) -> None:
    request = _completed(db)
    db.run("update crm.settings set google_review_url = %s", (LINK,))
    db.run("select crm.run_review_requests()", caller=SERVICE)

    db.run("select crm.mark_review_done(%s)", (request,), ADMIN)
    db.run("update crm.review_requests set reminder_due = current_date")

    assert db.value("select crm.run_review_requests()", caller=SERVICE) == 0
    assert [kind for kind, _ in _reviews(db)] == ["review_request"]


def test_the_reminder_days_come_from_the_settings(db: Database) -> None:
    _completed(db)
    db.run("update crm.settings set google_review_url = %s, review_reminder_days = 3", (LINK,))

    db.run("select crm.run_review_requests()", caller=SERVICE)

    assert db.value("select reminder_due - current_date from crm.review_requests") == 3


def test_both_review_mails_say_the_customer_can_object_by_a_short_reply(db: Database) -> None:
    bodies = db.rows(
        "select body from crm.mail_texts where key in ('review_request', 'review_reminder')"
    )

    assert len(bodies) == 2
    assert all(
        "Sie können solchen Anfragen jederzeit widersprechen" in row["body"] for row in bodies
    )


def test_a_customer_who_objected_gets_no_review_mail(db: Database) -> None:
    _completed(db)
    db.run("update crm.settings set google_review_url = %s", (LINK,))
    db.run("update crm.customers set no_review_requests = true")

    assert db.value("select crm.run_review_requests()", caller=SERVICE) == 0

    assert db.value("select status from crm.review_requests") == "cancelled"
    assert _reviews(db) == []


def test_an_objection_after_the_request_stops_the_reminder(db: Database) -> None:
    _completed(db)
    db.run("update crm.settings set google_review_url = %s", (LINK,))
    db.run("select crm.run_review_requests()", caller=SERVICE)
    db.run("update crm.customers set no_review_requests = true")
    db.run("update crm.review_requests set reminder_due = current_date")

    assert db.value("select crm.run_review_requests()", caller=SERVICE) == 0
    assert db.value("select status from crm.review_requests") == "cancelled"
