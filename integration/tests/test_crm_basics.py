"""The CRM chain from inquiry to cancellation and the customer file.

Context: Ported from crm/tests/sql/flow_test.sql and kundenakte_test.sql, with assertions instead of
printed results. | Input: a fresh project. | Output: Assertions on the crm schema.
"""

from decimal import Decimal
from typing import Any

import psycopg
import pytest
from steps import set_company

from repocity_integration.database import ADMIN, ANON, READER, SERVICE, Database


def _inquiry(db: Database) -> str:
    inquiry: str = db.value(
        "select crm.submit_inquiry('Erika Muster', 'erika@example.org', '0251 123', "
        "'Muster GmbH', 'Wir brauchen eine Webseite.', 'Webseite')",
        caller=ANON,
    )
    return inquiry


def _quote_from_inquiry(db: Database) -> dict[str, Any]:
    set_company(db)
    deal = db.value("select (crm.deal_from_inquiry(%s)).id", (_inquiry(db),), ADMIN)
    customer = db.value("select customer_id from crm.deals where id = %s", (deal,))
    quote = db.value("select (crm.create_quote(%s, %s)).id", (customer, deal), ADMIN)
    db.run(
        "insert into crm.quote_items (quote_id, position, title, quantity, unit_price_net) "
        "values (%s, 1, 'Webseite Basis', 1, 1500), (%s, 2, 'Texte', 3, 80)",
        (quote, quote),
        ADMIN,
    )
    return {"deal": deal, "customer": customer, "quote": quote}


def _open_invoice(db: Database) -> dict[str, Any]:
    ids = _quote_from_inquiry(db)
    db.run("select crm.mark_quote_sent(%s)", (ids["quote"],), ADMIN)
    ids["order"] = db.value("select (crm.accept_quote(%s)).id", (ids["quote"],), ADMIN)
    ids["invoice"] = db.value("select (crm.invoice_from_order(%s)).id", (ids["order"],), ADMIN)
    db.run("select crm.finalize_invoice(%s)", (ids["invoice"],), ADMIN)
    return ids


def test_the_website_form_creates_customer_inquiry_and_task(db: Database) -> None:
    _inquiry(db)

    assert db.one("select kind, name, contact_person, source from crm.customers") == {
        "kind": "company",
        "name": "Muster GmbH",
        "contact_person": "Erika Muster",
        "source": "website",
    }
    assert db.value("select title from crm.tasks") == "Anfrage von Muster GmbH beantworten"


def test_quote_totals_round_the_tax_per_rate(db: Database) -> None:
    ids = _quote_from_inquiry(db)

    assert db.one("select net, vat, gross from crm.quotes where id = %s", (ids["quote"],)) == {
        "net": 1740,
        "vat": Decimal("330.60"),
        "gross": Decimal("2070.60"),
    }


def test_acceptance_wins_the_deal(db: Database) -> None:
    ids = _quote_from_inquiry(db)

    db.run("select crm.accept_quote(%s)", (ids["quote"],), ADMIN)

    assert db.value("select stage from crm.deals where id = %s", (ids["deal"],)) == "won"


def test_finalising_numbers_the_invoice_with_the_payment_term(db: Database) -> None:
    ids = _open_invoice(db)

    invoice = db.one(
        "select number, status, due_date - issue_date as days, gross "
        "from crm.invoices where id = %s",
        (ids["invoice"],),
    )
    assert invoice["number"].startswith("RE-")
    assert (invoice["status"], invoice["days"], invoice["gross"]) == (
        "open",
        14,
        Decimal("2070.60"),
    )


@pytest.mark.parametrize(
    "statement",
    [
        "update crm.invoices set intro = 'geändert' where status = 'open'",
        "delete from crm.invoice_items where invoice_id in "
        "(select id from crm.invoices where status = 'open')",
    ],
)
def test_a_finalised_invoice_cannot_change(db: Database, statement: str) -> None:
    _open_invoice(db)

    with pytest.raises(psycopg.Error, match="festgeschrieben"):
        db.run(statement.encode(), caller=ADMIN)


def test_payments_add_up_until_paid(db: Database) -> None:
    ids = _open_invoice(db)

    partial = db.one(
        "select status, paid_amount from crm.record_payment(%s, 500)", (ids["invoice"],), ADMIN
    )
    rest = db.one(
        "select status, paid_amount from crm.record_payment(%s, 1570.60)", (ids["invoice"],), ADMIN
    )

    assert partial == {"status": "open", "paid_amount": 500}
    assert rest == {"status": "paid", "paid_amount": Decimal("2070.60")}


def test_dunning_steps_up_one_level_after_approval(db: Database) -> None:
    ids = _open_invoice(db)
    db.run(
        "set session_replication_role = replica; "
        "update crm.invoices set due_date = current_date - 20; "
        "set session_replication_role = origin"
    )

    assert db.value("select crm.run_dunning()", caller=ADMIN) == 1
    assert db.value("select crm.run_dunning()", caller=ADMIN) == 0
    approval = db.one("select id, title from crm.approvals where kind = 'dunning'")
    assert approval["title"].startswith("Zahlungserinnerung zu Rechnung RE-")
    db.run("select crm.decide_approval(%s, true)", (approval["id"],), ADMIN)

    assert db.value("select dunning_level from crm.invoices where id = %s", (ids["invoice"],)) == 1


def test_cancellation_creates_a_paid_credit_note(db: Database) -> None:
    ids = _open_invoice(db)

    credit = db.one(
        "select number, gross, status, cancels_invoice_id from crm.cancel_invoice(%s)",
        (ids["invoice"],),
        ADMIN,
    )

    assert (credit["gross"], credit["status"], credit["cancels_invoice_id"]) == (
        Decimal("-2070.60"),
        "paid",
        ids["invoice"],
    )
    assert db.value("select status from crm.invoices where id = %s", (ids["invoice"],)) == (
        "cancelled"
    )


def test_today_overview_counts_the_new_queues(db: Database) -> None:
    _open_invoice(db)
    db.run(
        "insert into crm.mail_triage (kind, direction, address, status) "
        "values ('unknown_sender', 'in', 'a@b.de', 'queued'), "
        "('unknown_sender', 'in', 'c@d.de', 'claimed'), "
        "('unknown_sender', 'in', 'e@f.de', 'failed')"
    )

    overview = db.value("select crm.today_overview()", caller=ADMIN)

    assert overview["receivables"] == 2070.6
    assert (
        overview["due_audits"],
        overview["mail_triage_waiting"],
        overview["mail_triage_failed"],
    ) == (0, 2, 1)


@pytest.mark.parametrize(
    ("column", "valid", "invalid"),
    [
        ("datev_consultant_number", "1234567", "12345678"),
        ("datev_client_number", "12345", "12a"),
        ("datev_tax_free_account", "8338", "833"),
    ],
)
def test_datev_numbers_are_digits_of_the_right_length(
    db: Database, column: str, valid: str, invalid: str
) -> None:
    statement = f"update crm.settings set {column} = %s".encode()

    db.run(statement, (valid,), ADMIN)
    db.run(statement, ("",), ADMIN)
    with pytest.raises(psycopg.errors.CheckViolation):
        db.run(statement, (invalid,), ADMIN)


def test_the_crm_app_reads_audits_customers_and_reports_of_the_radarauditor(db: Database) -> None:
    db.value(
        "select public.start_field_audit('korn.de', p_name => 'Korn', p_city => 'Münster')",
        caller=ADMIN,
    )
    db.run("insert into storage.objects (bucket_id, name) values ('reports', 'korn/bericht.pdf')")

    assert db.value("select count(*) from public.audits", caller=ADMIN) == 1
    assert db.value("select count(*) from public.customers", caller=ADMIN) == 1
    assert (
        db.value("select name from storage.objects where bucket_id = 'reports'", caller=ADMIN)
        == "korn/bericht.pdf"
    )


def test_a_reader_sees_but_cannot_write(db: Database) -> None:
    _inquiry(db)

    with pytest.raises(psycopg.Error, match="Nur der Administrator darf das."):
        db.run("select crm.create_quote((select id from crm.customers limit 1))", caller=READER)
    assert db.value("select count(*) from crm.customers", caller=READER) == 0


def _maintenance(db: Database) -> dict[str, Any]:
    set_company(db)
    customer = db.value(
        "insert into crm.customers (name, email) values ('Muster GmbH', 'erika@example.org') "
        "returning id",
        caller=ADMIN,
    )
    product = db.value(
        "insert into crm.products (name, description, unit, price_net, vat_rate, billing) "
        "values ('Wartung Radarauswertung', 'Monatliche Prüfung und Pflege', 'Monat', 99, 19, "
        "'monthly') returning id",
        caller=ADMIN,
    )
    subscription = db.value(
        "insert into crm.subscriptions (customer_id, product_id) values (%s, %s) returning id",
        (customer, product),
        ADMIN,
    )
    return {"customer": customer, "subscription": subscription}


def test_a_subscription_gets_a_rendered_maintenance_contract_queued(db: Database) -> None:
    ids = _maintenance(db)

    contract = db.one(
        "select title, status, monthly_net, body from crm.contracts where subscription_id = %s",
        (ids["subscription"],),
    )
    assert (contract["title"], contract["status"], contract["monthly_net"]) == (
        "Wartungs- und Servicevertrag",
        "queued",
        99,
    )
    assert "99,00 €" in contract["body"]
    assert "{{" not in contract["body"]
    mail = db.one("select to_address, subject, body from crm.outbox")
    assert mail["to_address"] == "erika@example.org"
    assert mail["subject"].startswith("Wartungs- und Servicevertrag VT-")
    assert "{{" not in mail["body"]


def test_signing_cancelling_and_the_customer_overview(db: Database) -> None:
    ids = _maintenance(db)
    contract = db.value("select id from crm.contracts")

    assert db.value("select (crm.mark_contract_signed(%s)).status", (contract,), ADMIN) == "signed"
    assert db.value("select crm.bill_subscriptions()", caller=ADMIN) == 1
    assert (
        db.value(
            "select (crm.cancel_subscription(%s, current_date + 40)).end_date - current_date",
            (ids["subscription"],),
            ADMIN,
        )
        == 40
    )
    overview = db.value("select crm.customer_overview(%s)", (ids["customer"],), ADMIN)

    assert (
        len(overview["purchases"]),
        len(overview["subscriptions"]),
        len(overview["contracts"]),
    ) == (1, 1, 1)
    assert (overview["monthly_net"], overview["open_amount"]) == (99, 117.81)


def test_the_intake_merges_by_address_and_is_closed_to_anon(db: Database) -> None:
    first = db.value(
        "select crm.intake_contact('email', 'Neu@Kunde.de', 'Max Neu', 'Neu GmbH', "
        "'', 'Angebot Webseite', 'Was kostet eine Webseite?')",
        caller=SERVICE,
    )
    second = db.value(
        "select crm.intake_contact('phone', 'neu@kunde.de', 'Max', '', '0251 1')", caller=SERVICE
    )

    assert first == second
    assert db.one("select name, contact_person, source, mail_backfilled from crm.customers") == {
        "name": "Neu GmbH",
        "contact_person": "Max Neu",
        "source": "email",
        "mail_backfilled": False,
    }
    assert db.one("select channel, subject from crm.inquiries") == {
        "channel": "email",
        "subject": "Angebot Webseite",
    }
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.run("select crm.intake_contact('email', 'x@y.de', 'x')", caller=ANON)


def test_unknown_senders_become_customers_or_are_ignored(db: Database) -> None:
    db.run(
        "insert into crm.mail_review (address, name, direction, subject, snippet, sent_at, "
        "verdict, reason) values "
        "('vielleicht@firma.de', 'Vera', 'in', 'Frage', 'Können Sie helfen?', now(), 'unsure', "
        "'unklar'), ('news@shop.de', '', 'in', 'Newsletter', '...', now(), 'automated', 'Liste')"
    )

    created = db.value(
        "select crm.decide_mail_review((select id from crm.mail_review "
        "where address = 'vielleicht@firma.de'), true)",
        caller=ADMIN,
    )
    ignored = db.value(
        "select crm.decide_mail_review((select id from crm.mail_review "
        "where address = 'news@shop.de'), false)",
        caller=ADMIN,
    )

    assert created is not None
    assert ignored is None
    assert db.value("select address from crm.mail_ignore") == "news@shop.de"
    db.run("select crm.dismiss_customer(%s)", (created,), ADMIN)
    assert db.value("select count(*) from crm.customers") == 0


def test_a_customer_with_business_cannot_be_dismissed(db: Database) -> None:
    ids = _quote_from_inquiry(db)

    with pytest.raises(psycopg.Error, match="bleibt deshalb erhalten"):
        db.run("select crm.dismiss_customer(%s)", (ids["customer"],), ADMIN)
