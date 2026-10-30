"""The Cockpit: CRM events become messages and pushes, duplicates are ignored, checks run hourly.

Context: Ported from cockpit/tests/sql/cockpit_test.sql and extended by actions and tags. | Input: a
fresh project. | Output: Assertions on cockpit.messages and the recorded push calls.
"""

import json

import psycopg
import pytest

from repocity_integration.database import ADMIN, ANON, READER, SERVICE, Database


def _customer(db: Database) -> str:
    customer: str = db.value(
        "insert into crm.customers (name, email, source) "
        "values ('Muster GmbH', 'info@muster.de', 'website') returning id",
        caller=ADMIN,
    )
    return customer


def test_crm_events_become_messages(db: Database) -> None:
    customer = _customer(db)
    db.run(
        "insert into crm.approvals (kind, title, body, customer_id) "
        "values ('quote', 'Angebot A-1 senden', e'Bitte\\nprüfen', %s)",
        (customer,),
        ADMIN,
    )
    invoice = db.value(
        "insert into crm.invoices (number, customer_id, status) values ('R-1', %s, 'open') "
        "returning id",
        (customer,),
        ADMIN,
    )
    db.run("insert into crm.payments (invoice_id, amount) values (%s, 1234.5)", (invoice,), ADMIN)

    assert db.rows(
        "select kind, title, body, priority, actions from cockpit.messages "
        "order by created_at, kind"
    ) == [
        {
            "kind": "kunde",
            "title": "Neuer Kunde: Muster GmbH",
            "body": "Quelle: Webseite · info@muster.de",
            "priority": "wichtig",
            "actions": [],
        },
        {
            "kind": "freigabe",
            "title": "Freigabe nötig: Angebot A-1 senden",
            "body": "Bitte prüfen",
            "priority": "wichtig",
            "actions": [],
        },
        {
            "kind": "zahlung",
            "title": "Zahlung eingegangen: 1.234,50 €",
            "body": "Muster GmbH · Rechnung R-1",
            "priority": "info",
            "actions": [],
        },
    ]


def test_every_message_is_pushed_once(db: Database) -> None:
    _customer(db)

    calls = db.rows("select url, headers, body from net.calls")
    message = db.value("select id from cockpit.messages")
    assert calls == [
        {
            "url": "https://yizvntdwdajlgcbjcves.supabase.co/functions/v1/cockpit-push",
            "headers": {
                "Content-Type": "application/json",
                "Authorization": "Bearer test-service-key",
            },
            "body": {"action": "send", "message_id": str(message)},
        }
    ]


def test_a_repeated_dedupe_key_is_ignored(db: Database) -> None:
    first = db.value(
        "select cockpit.notify('system', 'test', 'Erste', '', '', 'info', 'gleich')", caller=ADMIN
    )
    second = db.value(
        "select cockpit.notify('system', 'test', 'Zweite', '', '', 'info', 'gleich')", caller=ADMIN
    )

    assert first is not None
    assert second is None


def test_daily_brief_sums_up_the_day(db: Database) -> None:
    _customer(db)

    assert db.value("select cockpit.daily_brief()", caller=ADMIN) is not None

    assert db.one("select title, body from cockpit.messages where kind = 'tagesueberblick'") == {
        "title": "Guten Morgen – alles ruhig",
        "body": "Offene Forderungen 0,00 € · Eingang im Monat 0,00 €",
    }


def test_a_reader_may_not_notify(db: Database) -> None:
    with pytest.raises(psycopg.Error, match="Kein Zugriff"):
        db.run("select cockpit.notify('system', 'x', 'nicht erlaubt')", caller=READER)


def test_a_refusing_notice_never_stops_the_crm(db: Database) -> None:
    db.run("alter table cockpit.messages add constraint refuse check (false) not valid")

    _customer(db)

    assert db.value("select count(*) from crm.customers") == 1
    assert db.value("select count(*) from cockpit.messages") == 0


def test_a_silent_mailbox_is_reported_once_per_day(db: Database) -> None:
    db.run(
        "insert into crm.mail_sync (folder, synced_at) values ('INBOX', now() - interval '2 hours')"
    )

    db.run("select cockpit.check_health()", caller=SERVICE)
    db.run("select cockpit.check_health()", caller=SERVICE)

    assert db.value("select count(*) from cockpit.messages where kind = 'postfach'") == 1


def test_a_triage_backlog_is_reported_once_per_day(db: Database) -> None:
    db.run(
        "insert into crm.mail_triage (kind, direction, address, created_at) "
        "values ('unknown_sender', 'in', 'a@b.de', now() - interval '2 hours'), "
        "('unknown_sender', 'in', 'c@d.de', now())"
    )

    db.run("select cockpit.check_health()", caller=SERVICE)
    db.run("select cockpit.check_health()", caller=SERVICE)

    assert db.rows(
        "select title, priority from cockpit.messages where kind = 'mail-auswertung-stau'"
    ) == [{"title": "Mails werden nicht gelesen – läuft der Server?", "priority": "dringend"}]


def test_a_fresh_triage_queue_is_no_backlog(db: Database) -> None:
    db.run(
        "insert into crm.mail_triage (kind, direction, address) values ('unknown_sender', 'in', "
        "'a@b.de')"
    )

    db.run("select cockpit.check_health()", caller=SERVICE)

    assert (
        db.value("select count(*) from cockpit.messages where kind = 'mail-auswertung-stau'") == 0
    )


def test_notify_action_keeps_actions_payload_and_tag(db: Database) -> None:
    actions = [{"action": "approve", "title": "Senden"}]

    message = db.value(
        "select cockpit.notify_action('crm', 'test', 'Titel', 'Text', '', 'info', null, "
        "%s::jsonb, '{\"approval_id\": \"x\"}', 'gruppe')",
        (json.dumps(actions),),
        SERVICE,
    )

    assert db.one(
        "select actions, action_payload, tag, acted_at from cockpit.messages where id = %s",
        (message,),
    ) == {
        "actions": actions,
        "action_payload": {"approval_id": "x"},
        "tag": "gruppe",
        "acted_at": None,
    }


@pytest.mark.parametrize(
    "actions",
    [
        [
            {"action": "approve", "title": "a"},
            {"action": "reject", "title": "b"},
            {"action": "start_audit", "title": "c"},
            {"action": "audit_check", "title": "d"},
        ],
        [{"action": "delete_all", "title": "x"}],
        [{"action": "approve"}],
    ],
)
def test_notify_action_refuses_actions_outside_the_shape(
    db: Database, actions: list[dict[str, str]]
) -> None:
    with pytest.raises(psycopg.Error, match="Aktionen"):
        db.run(
            "select cockpit.notify_action('crm', 'test', 'Titel', '', '', 'info', null, "
            "%s::jsonb, '{}', null)",
            (json.dumps(actions),),
            SERVICE,
        )


def test_anon_reaches_run_action_and_nothing_else(db: Database) -> None:
    answer = db.value(
        "select cockpit.run_action(gen_random_uuid(), gen_random_uuid(), 'approve')", caller=ANON
    )

    assert answer == {"ok": False, "text": "Diese Aktion ist nicht gültig."}
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.run("select count(*) from cockpit.messages", caller=ANON)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.run("select cockpit.notify('system', 'x', 'y')", caller=ANON)
