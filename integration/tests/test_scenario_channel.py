"""Scenarios H1-H8: where a customer came from, down to the channel and the campaign.

Context: Links of the marketing app carry utm_source, utm_medium and utm_campaign; the website form
hands them on, the contact mail names the channel in its subject ("Anfrage – über LinkedIn
(kampagne)"), the phone assistant asks; the CRM keeps the first channel of a customer and counts
inquiries, new customers and revenue per channel (migration crm/011_herkunft.sql). | Input: the
form, mails and calls as the apps send them. | Output: Assertions on customers, inquiries and
crm.channel_report.
"""

from datetime import UTC, datetime
from decimal import Decimal

import psycopg
import pytest

from repocity_integration.database import ADMIN, ANON, SERVICE, Database

TODAY = datetime.now(UTC).date()


@pytest.mark.parametrize(
    ("source", "medium", "channel"),
    [
        ("google", "maps", "google_maps"),
        ("Google", "organic", "google_search"),
        ("linkedin", "social", "linkedin"),
        ("ig", "social", "instagram"),
        ("x", "social", "x"),
        ("newsletter", "email", "newsletter"),
        ("empfehlung", "", "referral"),
        ("irgendwas", "", "other"),
        ("", "", None),
    ],
)
def test_h1_link_markers_become_a_channel(
    db: Database, source: str, medium: str, channel: str | None
) -> None:
    assert db.value("select crm.channel_from(%s, %s)", (source, medium)) == channel


def _form(db: Database, email: str, **utm: str) -> str:
    inquiry: str = db.value(
        "select crm.submit_inquiry(p_name => 'Erika Korn', p_email => %(email)s, "
        "p_message => 'Bitte um ein Angebot.', p_source => 'Kontaktformular', "
        "p_utm_source => %(source)s, p_utm_medium => %(medium)s, p_utm_campaign => %(campaign)s)",
        {"email": email, "source": "", "medium": "", "campaign": "", **utm},
        ANON,
    )
    return inquiry


def test_h2_the_form_keeps_channel_and_campaign_of_the_link(db: Database) -> None:
    inquiry = _form(
        db, "erika@korn.de", source="linkedin", medium="social", campaign="sichtbarkeit-muenster"
    )

    row = db.one(
        "select c.channel, c.campaign, i.source_channel, i.campaign as inquiry_campaign "
        "from crm.inquiries i join crm.customers c on c.id = i.customer_id where i.id = %s",
        (inquiry,),
    )
    assert row == {
        "channel": "linkedin",
        "campaign": "sichtbarkeit-muenster",
        "source_channel": "linkedin",
        "inquiry_campaign": "sichtbarkeit-muenster",
    }


def test_h3_the_first_channel_of_a_customer_stays(db: Database) -> None:
    _form(db, "erika@korn.de", source="google", medium="maps")
    _form(db, "erika@korn.de", source="instagram", medium="social")

    assert db.value("select channel from crm.customers") == "google_maps"
    assert [
        row["source_channel"]
        for row in db.rows("select source_channel from crm.inquiries order by created_at")
    ] == ["google_maps", "instagram"]


def test_h4_the_contact_mail_names_the_channel_in_its_subject(db: Database) -> None:
    db.value(
        "select crm.intake_contact('email', 'erika@korn.de', 'Erika Korn', '', '', "
        "'Anfrage – über LinkedIn (sichtbarkeit-muenster)', 'Hallo')",
        caller=SERVICE,
    )
    db.value(
        "select crm.intake_contact('email', 'otto@maler.de', 'Otto Maler', '', '', "
        "'Anfrage – über Google Maps', 'Hallo')",
        caller=SERVICE,
    )

    assert db.one(
        "select * from crm.channel_from_subject("
        "'Frage über Preise – Anfrage – über LinkedIn (test)')"
    ) == {"channel": "linkedin", "campaign": "test"}
    assert db.rows("select email, channel, campaign from crm.customers order by email") == [
        {"email": "erika@korn.de", "channel": "linkedin", "campaign": "sichtbarkeit-muenster"},
        {"email": "otto@maler.de", "channel": "google_maps", "campaign": ""},
    ]


def test_h5_the_phone_assistant_hands_on_what_the_caller_said(db: Database) -> None:
    db.value(
        "select crm.intake_call(p_caller_number => '+49 251 1234567', p_name => 'Erika Korn', "
        "p_company => '', p_email => '', p_subject => 'Neue Webseite', p_message => 'Rückruf', "
        "p_channel => 'referral')",
        caller=SERVICE,
    )

    assert db.value("select channel from crm.customers") == "referral"


def test_h6_an_unknown_channel_is_refused(db: Database) -> None:
    customer: str = db.value(
        "insert into crm.customers (name, email) values ('Korn', 'erika@korn.de') returning id"
    )

    with pytest.raises(psycopg.errors.CheckViolation):
        db.run("update crm.customers set channel = 'presse' where id = %s", (customer,), ADMIN)


def test_h7_the_report_counts_inquiries_customers_and_revenue_per_channel(db: Database) -> None:
    _form(db, "erika@korn.de", source="linkedin", medium="social")
    _form(db, "erika@korn.de", source="linkedin", medium="social")
    _form(db, "otto@maler.de")
    customer: str = db.value("select id from crm.customers where email = 'erika@korn.de'")
    db.run(
        "set session_replication_role = replica; "
        "insert into crm.invoices (id, customer_id, number, status, issue_date, due_date, gross) "
        f"values ('00000000-0000-4000-8000-0000000000e1', '{customer}', 'RE-2026-0001', 'open', "
        "current_date, current_date + 14, 119); "
        "insert into crm.payments (invoice_id, amount, paid_on) "
        "values ('00000000-0000-4000-8000-0000000000e1', 119, current_date); "
        "set session_replication_role = origin".encode()
    )

    rows = db.rows(
        "select channel, inquiries, customers, revenue from crm.channel_report(%s, %s) "
        "order by channel",
        (TODAY.replace(day=1), TODAY),
        ADMIN,
    )

    assert rows == [
        {"channel": "linkedin", "inquiries": 2, "customers": 1, "revenue": Decimal("119.00")},
        {"channel": "unknown", "inquiries": 1, "customers": 1, "revenue": Decimal("0")},
    ]


def test_h8_the_labels_are_plain_german(db: Database) -> None:
    labels = db.rows(
        "select crm.source_channel_label(c) as label from unnest(array['google_search', "
        "'google_maps', 'referral', 'unknown']) c"
    )

    assert [row["label"] for row in labels] == [
        "Google-Suche",
        "Google Maps",
        "Empfehlung",
        "Unbekannt",
    ]


@pytest.mark.parametrize(
    "subject", ["Frage – über LinkedIn", "Frage über Xing", "Re: Termin über Instagram"]
)
def test_h9_only_the_website_subject_names_a_channel(db: Database, subject: str) -> None:
    assert db.one("select * from crm.channel_from_subject(%s)", (subject,)) == {
        "channel": None,
        "campaign": "",
    }
    assert db.one(
        "select * from crm.channel_from_subject(%s)", ("AW: Anfrage – über LinkedIn (test)",)
    ) == {"channel": "linkedin", "campaign": "test"}
