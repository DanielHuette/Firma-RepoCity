"""The shared Supabase database of RadarAuditor, CRM and Cockpit, built in the live order.

Context: All three apps migrate one project; their migrations depend on each other, so they are
applied in the order the live project got them. | Input: the migration folders of this repository
and sql/supabase_stub.sql. | Output: MIGRATION_ORDER, build_project and the users the tests act as.
"""

import re
from pathlib import Path
from uuid import UUID

import psycopg

REPOSITORY = Path(__file__).resolve().parents[3]
STUB = REPOSITORY / "integration" / "sql" / "supabase_stub.sql"

_RADAR = "radarauditor/supabase/migrations"
_CRM = "crm/supabase/migrations"
_COCKPIT = "cockpit/supabase/migrations"

MIGRATION_ORDER: tuple[str, ...] = (
    f"{_RADAR}/001_schema.sql",
    f"{_RADAR}/002_functions.sql",
    f"{_RADAR}/003_security.sql",
    f"{_RADAR}/004_access.sql",
    f"{_RADAR}/005_roles.sql",
    f"{_CRM}/001_crm.sql",
    f"{_CRM}/002_kundenakte.sql",
    f"{_CRM}/003_postfach.sql",
    f"{_COCKPIT}/001_cockpit.sql",
    f"{_RADAR}/006_field_app.sql",
    f"{_RADAR}/007_serp_retry.sql",
    f"{_RADAR}/009_source_cost.sql",
    f"{_RADAR}/010_manual_changes.sql",
    f"{_RADAR}/011_url_only_audit.sql",
    f"{_RADAR}/012_field_audit_parts.sql",
    f"{_RADAR}/013_crm_handover.sql",
    f"{_RADAR}/014_remove_billing.sql",
    f"{_CRM}/004_flow.sql",
    f"{_COCKPIT}/002_actions.sql",
    f"{_CRM}/005_calls.sql",
    f"{_RADAR}/015_link_crm_leads.sql",
    f"{_COCKPIT}/003_scenario_fixes.sql",
    f"{_CRM}/006_scenario_fixes.sql",
    f"{_CRM}/007_finanzen.sql",
    f"{_COCKPIT}/004_payment_buttons.sql",
    f"{_CRM}/008_rueckbuchung_belege.sql",
    f"{_COCKPIT}/005_reversal_buttons.sql",
    f"{_CRM}/009_kalender.sql",
    f"{_CRM}/010_nachfassen.sql",
    f"{_COCKPIT}/006_kalender_nachfassen.sql",
    f"{_CRM}/011_herkunft.sql",
    f"{_CRM}/012_assistent.sql",
    f"{_CRM}/013_audit_anfragen.sql",
    f"{_COCKPIT}/007_audit_anfragen.sql",
)

ADMIN_ID = UUID("00000000-0000-4000-8000-00000000000a")
READER_ID = UUID("00000000-0000-4000-8000-00000000000b")

# pg_cron and pg_net cannot be installed into a plain PostgreSQL; the stub provides their functions.
_PROVIDED_EXTENSION = re.compile(
    r"^create extension if not exists (pg_cron|pg_net)\b[^;]*;$", re.IGNORECASE | re.MULTILINE
)


def migration_sql(relative_path: str) -> str:
    """Text of a migration as applied here: extensions the stub provides are not created."""
    text = (REPOSITORY / relative_path).read_text(encoding="utf-8")
    return _PROVIDED_EXTENSION.sub("", text)


def build_project(conninfo: str) -> None:
    """Apply the stub and every migration, each in its own transaction, then add the two users.

    Args:
        conninfo: Connection string of an empty database, as the superuser.

    Raises:
        psycopg.Error: If a migration fails; a note names the file.
    """
    with psycopg.connect(conninfo, autocommit=True) as connection:
        connection.execute(STUB.read_bytes())
        for relative_path in MIGRATION_ORDER:
            try:
                with connection.transaction():
                    connection.execute(migration_sql(relative_path).encode())
            except psycopg.Error as error:
                error.add_note(f"while applying {relative_path}")
                raise
        with connection.transaction():
            connection.execute(
                "insert into auth.users (id, email) values (%s, 'admin@example.test'), "
                "(%s, 'reader@example.test')",
                (ADMIN_ID, READER_ID),
            )
            connection.execute("insert into public.app_admins (user_id) values (%s)", (ADMIN_ID,))
