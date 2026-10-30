"""Scenarios L1-L6: a lead arrives by web form, unknown mail or phone and meets the field audit.

Context: Whichever way a business first reaches RepoCity, the audit in the field must land on the
same CRM customer, and a quote must go out without retyping what is already known. | Input: the
callers in actors.py. | Output: Assertions on CRM customers, inquiries, triage rows and Cockpit.
"""

from actors import (
    apply_unknown_verdicts,
    field_audit,
    park_unknown_sender,
    phone_intake,
    radar_quote,
    save_crm_email,
    server_classifies,
    server_fails,
    web_form,
)
from steps import add_products, outbox, set_company

from repocity_integration.database import ADMIN, SERVICE, Database

WEBSITE = "baeckerei-korn.de"
EMAIL = "info@baeckerei-korn.de"


def _quote_sent(db: Database, customer: str) -> str:
    once, _ = add_products(db)
    quote = radar_quote(db, customer, [(once, "Website-Optimierung", "Stück", 900)])
    db.run("select crm.send_quote(p_quote => %s)", (quote,), ADMIN)
    subject: str = db.value("select subject from crm.outbox where quote_id = %s", (quote,))
    return subject


def test_l1_a_web_form_lead_is_the_customer_the_field_audit_finds(db: Database) -> None:
    set_company(db)
    web_form(db, "Erika Korn", EMAIL, company="Bäckerei Korn")

    linked = field_audit(db, WEBSITE, "Bäckerei Korn", "Münster")

    customers = db.rows("select id, email, city, source from crm.customers")
    assert customers == [{"id": linked, "email": EMAIL, "city": "Münster", "source": "website"}]
    assert _quote_sent(db, linked).startswith("Angebot AN-")
    assert [m["to_address"] for m in outbox(db)] == [EMAIL]


def test_l2_an_unknown_sender_classified_as_customer_is_the_audited_customer(
    db: Database,
) -> None:
    set_company(db)
    park_unknown_sender(db, EMAIL, "Erika Korn")
    verdict = {
        "verdict": "customer",
        "name": "Erika Korn",
        "company": "Bäckerei Korn",
        "reason": "fragt nach einer Webseite",
    }

    assert server_classifies(db, {EMAIL: verdict}) == ["classified"]
    [taken_in] = apply_unknown_verdicts(db)
    linked = field_audit(db, WEBSITE, "Bäckerei Korn", "Münster")

    assert linked == taken_in
    assert db.value("select count(*) from crm.customers") == 1
    assert db.value("select status from crm.mail_triage") == "applied"
    assert db.value("select channel from crm.inquiries") == "email"
    assert _quote_sent(db, linked).startswith("Angebot AN-")


def test_l3_a_phone_lead_gets_its_address_in_the_field_and_is_one_customer(db: Database) -> None:
    set_company(db)
    caller = phone_intake(db, "+49 251 1234567", "Bäckerei Korn")

    linked = field_audit(db, WEBSITE, "Bäckerei Korn", "Münster")
    save_crm_email(db, linked, "Info@Baeckerei-Korn.de")

    assert linked == caller
    assert db.one("select email, phone, source from crm.customers") == {
        "email": EMAIL,
        "phone": "+49 251 1234567",
        "source": "phone",
    }
    assert _quote_sent(db, linked).startswith("Angebot AN-")


def test_l4_the_same_address_on_every_channel_stays_one_customer(db: Database) -> None:
    web_form(db, "Erika Korn", EMAIL, company="Bäckerei Korn")
    web_form(db, "Erika Korn", EMAIL.upper(), company="Bäckerei Korn")
    park_unknown_sender(db, "erika@other.de", "Erika")
    server_classifies(db, {"erika@other.de": {"verdict": "customer", "name": "Erika"}})
    apply_unknown_verdicts(db)
    db.run(
        "select crm.intake_contact('email', %s, 'Erika Korn', p_subject => 'Anfrage')",
        (EMAIL,),
        SERVICE,
    )
    phone_intake(db, None, "Erika Korn", email=EMAIL.upper())

    assert db.value("select count(*) from crm.customers where email = %s", (EMAIL,)) == 1
    assert (
        db.value(
            "select count(*) from crm.inquiries i join crm.customers c on c.id = i.customer_id "
            "where c.email = %s",
            (EMAIL,),
        )
        == 4
    )
    assert db.value("select count(*) from cockpit.messages where kind = 'kunde'") == 2


def test_l5_the_same_number_in_another_spelling_stays_one_customer(db: Database) -> None:
    first = phone_intake(db, "0251 1234567", "Bäckerei Korn")
    second = phone_intake(db, "+49 (0)251 123 45 67", "Erika Korn")

    assert first == second
    assert db.value("select count(*) from crm.tasks where title like 'Rückruf %%'") == 2


def test_l6_a_mail_the_server_cannot_read_is_retried_and_then_left_to_daniel(
    db: Database,
) -> None:
    park_unknown_sender(db, EMAIL, "Erika Korn")

    statuses = []
    for _ in range(3):
        statuses += server_fails(db, "Claude Code antwortet nicht")
        db.run("update crm.mail_triage set claimed_until = now() - interval '1 second'")
    apply_unknown_verdicts(db)

    assert statuses == ["queued", "queued", "failed"]
    assert db.value("select status from crm.mail_triage") == "applied"
    assert db.value("select count(*) from crm.customers") == 0
    assert db.one("select address, verdict, status from crm.mail_review") == {
        "address": EMAIL,
        "verdict": "unsure",
        "status": "open",
    }
    assert db.value("select title from cockpit.messages where kind = 'absender'") == (
        "Möglicher Kunde: Erika Korn"
    )
    assert (
        db.value("select count(*) from cockpit.messages where kind = 'mail-auswertung-fehler'") == 1
    )
