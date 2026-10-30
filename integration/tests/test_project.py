"""The project builds in the live order, and the security rules of every migration hold.

Context: Guards the migration order, the rights of every role, the removed Anthropic key, the cron
job and that the new migrations can run twice. | Input: the built project. | Output: Assertions.
"""

import psycopg
import pytest

from repocity_integration.database import ADMIN, ANON, SERVICE, Database
from repocity_integration.project import migration_sql

SERVICE_ONLY = [
    "crm.set_secret(text,text)",
    "crm.mail_config()",
    "crm.acquire_mail_lease(integer)",
    "crm.release_mail_lease()",
    "crm.intake_contact(text,text,text,text,text,text,text)",
    "crm.claim_mail_triage(integer,integer)",
    "crm.classify_mail_triage(uuid,jsonb)",
    "crm.fail_mail_triage(uuid,text)",
    "crm.intake_call(text,text,text,text,text,text,text)",
    "crm.phone_quote_decision(text,text,text,text)",
    "crm.record_call(jsonb)",
    "crm.check_receipts()",
    "crm.remind_appointments()",
    "crm.calendar_events(uuid)",
    "crm.callback_from_call(text,text,text,timestamp with time zone)",
    "crm.expire_quotes()",
    "crm.run_follow_ups()",
    "crm.opt_out(uuid)",
    "crm.claim_assistant_request()",
    "crm.save_assistant_transcript(uuid,text)",
    "crm.apply_assistant_intent(uuid,jsonb)",
    "crm.fail_assistant_request(uuid,text)",
    "crm.orphan_recordings()",
    "crm.confirm_audit_request(uuid)",
    "crm.propose_audit_times(uuid)",
    "crm.send_audit_proposal(uuid,uuid)",
    "crm.check_audit_website(uuid)",
    "crm.audit_offer_view(uuid)",
    "crm.book_audit_offer(uuid)",
    "crm.audit_reschedule_view(uuid)",
    "crm.request_audit_reschedule(uuid)",
    "crm.remind_audit_requests()",
    "crm.send_appointment_reminders()",
]
ANON_ALLOWED = [
    "crm.submit_inquiry(text,text,text,text,text,text,text,text,text)",
    "crm.audit_slots(text)",
    "crm.request_audit(text,text,text,text,text,text,text,timestamp with time zone,"
    "text,text,text,text,uuid)",
    "cockpit.run_action(uuid,uuid,text)",
]
RERUNNABLE = [
    "radarauditor/supabase/migrations/013_crm_handover.sql",
    "crm/supabase/migrations/004_flow.sql",
    "cockpit/supabase/migrations/002_actions.sql",
    "crm/supabase/migrations/005_calls.sql",
    "crm/supabase/migrations/008_rueckbuchung_belege.sql",
    "cockpit/supabase/migrations/005_reversal_buttons.sql",
    "crm/supabase/migrations/009_kalender.sql",
    "crm/supabase/migrations/010_nachfassen.sql",
    "cockpit/supabase/migrations/006_kalender_nachfassen.sql",
    "crm/supabase/migrations/011_herkunft.sql",
    "crm/supabase/migrations/012_assistent.sql",
    "crm/supabase/migrations/013_audit_anfragen.sql",
    "cockpit/supabase/migrations/007_audit_anfragen.sql",
]


def test_mail_texts_are_seeded_and_signed_by_the_owner(db: Database) -> None:
    texts = db.rows("select key, subject, body from crm.mail_texts order by key")

    assert [text["key"] for text in texts] == [
        "appointment",
        "appointment_reminder",
        "audit_cancellation",
        "audit_confirmation",
        "audit_proposal",
        "audit_rebooking",
        "dunning_1",
        "dunning_2",
        "dunning_3",
        "follow_up_1",
        "follow_up_2",
        "invoice",
        "quote",
        "review_reminder",
        "review_request",
    ]
    assert all(text["body"].endswith("Mit freundlichen Grüßen\n{{inhaber}}") for text in texts)


def test_service_only_functions_are_closed_to_signed_in_users_and_anon(db: Database) -> None:
    rows = db.rows(
        "select f as name, has_function_privilege('authenticated', f::regprocedure, 'execute') "
        "as authenticated, has_function_privilege('anon', f::regprocedure, 'execute') as anon, "
        "has_function_privilege('service_role', f::regprocedure, 'execute') as service "
        "from unnest(%s::text[]) f",
        (SERVICE_ONLY,),
    )

    assert [(r["authenticated"], r["anon"], r["service"]) for r in rows] == [
        (False, False, True)
    ] * len(SERVICE_ONLY)


def test_anon_may_run_only_the_form_and_the_lock_screen_action(db: Database) -> None:
    allowed = db.rows(
        "select p.oid::regprocedure::text as name from pg_proc p "
        "where p.pronamespace in ('crm'::regnamespace, 'cockpit'::regnamespace) "
        "and has_function_privilege('anon', p.oid, 'execute') order by 1"
    )

    assert [row["name"] for row in allowed] == sorted(ANON_ALLOWED)


def test_anon_reaches_no_table_of_crm_or_cockpit(db: Database) -> None:
    assert (
        db.value(
            "select count(*) from pg_class c where c.relnamespace in "
            "('crm'::regnamespace, 'cockpit'::regnamespace) and c.relkind = 'r' "
            "and has_table_privilege('anon', c.oid, 'select, insert, update, delete')"
        )
        == 0
    )


def test_every_table_of_crm_and_cockpit_has_row_level_security(db: Database) -> None:
    assert (
        db.rows(
            "select c.oid::regclass::text as name from pg_class c where c.relnamespace in "
            "('crm'::regnamespace, 'cockpit'::regnamespace) and c.relkind = 'r' "
            "and not c.relrowsecurity"
        )
        == []
    )


def test_definer_functions_have_a_fixed_search_path(db: Database) -> None:
    assert (
        db.rows(
            "select p.oid::regprocedure::text as name from pg_proc p "
            "where p.pronamespace in ('crm'::regnamespace, 'cockpit'::regnamespace, "
            "'public'::regnamespace) and p.prosecdef and p.proconfig is null"
        )
        == []
    )


def test_the_anthropic_key_is_gone(db: Database) -> None:
    db.run("select crm.set_secret('crm_mail_address', 'info@repocity.de')", caller=SERVICE)

    with pytest.raises(psycopg.Error, match="Unbekannter Schlüssel crm_anthropic_key"):
        db.run("select crm.set_secret('crm_anthropic_key', 'sk-test')", caller=SERVICE)
    assert db.value("select crm.mail_config()", caller=SERVICE) == {
        "crm_mail_address": "info@repocity.de"
    }


def test_rerunning_the_new_migrations_keeps_data_and_removes_a_stray_key(db: Database) -> None:
    db.run("update crm.mail_texts set subject = 'Mein Betreff' where key = 'quote'")
    db.run("insert into vault.secrets (name, secret) values ('crm_anthropic_key', 'sk-alt')")
    customer = db.value("insert into crm.customers (name) values ('Korn') returning id")
    kinds = ("appointment", "follow_up", "assistant", "audit_proposal", "appointment_reminder")
    for kind in (*kinds, "appointment_cancel"):
        db.run(
            "insert into crm.outbox (customer_id, kind, to_address, subject, body) "
            "values (%s, %s, 'a@b.de', 'x', 'y')",
            (customer, kind),
        )
    for kind in ("follow_up", "assistant_mail"):
        db.run("insert into crm.approvals (kind, title) values (%s, 'x')", (kind,))

    for path in RERUNNABLE:
        db.run(migration_sql(path).encode())

    assert db.value("select subject from crm.mail_texts where key = 'quote'") == "Mein Betreff"
    assert db.value("select count(*) from vault.secrets where name = 'crm_anthropic_key'") == 0
    assert db.value("select count(*) from cron.job where jobname = 'crm-daily'") == 1
    assert db.value("select count(*) from crm.outbox") == 6
    for call in (
        "crm.opt_out(gen_random_uuid())",
        "crm.claim_assistant_request()",
        "crm.intake_contact('email', 'a@b.de', 'A')",
    ):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            db.run(f"select {call}", caller=ADMIN)


def test_signed_in_users_never_see_the_triage_functions_fail_open(db: Database) -> None:
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.run("select crm.mail_config()", caller=ADMIN)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.run("select crm.daily_routine()", caller=ANON)


def test_every_function_has_a_fixed_search_path(db: Database) -> None:
    """Without one a function finds tables through the caller's search path (Supabase lint 0011)."""
    loose = db.rows(
        "select p.oid::regprocedure::text as function from pg_proc p "
        "join pg_namespace n on n.oid = p.pronamespace "
        "where n.nspname in ('crm', 'cockpit', 'public') and p.prokind = 'f' "
        "and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') "
        "and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c "
        "where c like 'search_path=%%') order by 1"
    )

    assert loose == []


# Functions a later migration replaces and an earlier one carries in the same version, so that
# running the earlier one again keeps the newer state.
SAME_VERSIONS = [
    (
        "crm.appointment_kind_label",
        "crm/supabase/migrations/009_kalender.sql",
        "crm/supabase/migrations/013_audit_anfragen.sql",
    ),
    (
        "crm.check_appointment",
        "crm/supabase/migrations/009_kalender.sql",
        "crm/supabase/migrations/013_audit_anfragen.sql",
    ),
    (
        "crm.today_overview",
        "crm/supabase/migrations/009_kalender.sql",
        "crm/supabase/migrations/013_audit_anfragen.sql",
    ),
    (
        "cockpit.valid_actions",
        "cockpit/supabase/migrations/002_actions.sql",
        "cockpit/supabase/migrations/007_audit_anfragen.sql",
    ),
    (
        "cockpit.perform_action",
        "cockpit/supabase/migrations/002_actions.sql",
        "cockpit/supabase/migrations/007_audit_anfragen.sql",
    ),
    (
        "cockpit.on_crm_customer",
        "cockpit/supabase/migrations/002_actions.sql",
        "cockpit/supabase/migrations/007_audit_anfragen.sql",
    ),
]


def _definition(path: str, name: str) -> str:
    text = migration_sql(path)
    start = text.index(f"create or replace function {name}(")
    body = text.index("$$", text.index(" as $$", start) + len(" as $$"))
    return text[start : body + 2]


@pytest.mark.parametrize(("name", "earlier", "later"), SAME_VERSIONS)
def test_an_earlier_migration_carries_the_newest_version(
    name: str, earlier: str, later: str
) -> None:
    assert _definition(earlier, name) == _definition(later, name)
