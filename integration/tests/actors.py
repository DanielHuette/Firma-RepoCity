"""The calls every part of RepoCity makes, in the same shape as its source, for the scenario tests.

Context: Each function stands for one caller (web form, mail worker, server worker, phone agent,
RadarAuditor app and worker, CRM app, Cockpit) and sends exactly the call that caller's code sends,
as the database role it uses. | Input: a test database. | Output: ids and answers of the calls.
"""

import json
from typing import Any

from repocity_integration.database import ADMIN, ANON, SERVICE, Database

MAILBOX = "daniel@repocity.de"


# Website form (anon key)


def web_form(db: Database, name: str, email: str, company: str = "", phone: str = "") -> str:
    """crm.submit_inquiry as the contact form of the website sends it."""
    inquiry: str = db.value(
        "select crm.submit_inquiry(p_name => %s, p_email => %s, p_phone => %s, "
        "p_company => %s, p_message => 'Bitte um ein Angebot.', p_source => 'Kontaktformular')",
        (name, email, phone, company),
        ANON,
    )
    return inquiry


# Mail worker (Edge Function crm-mail, service key)


def file_customer_mail(db: Database, customer: str, address: str, verified: bool) -> str:
    """fileMail: the mail goes into crm.emails and, as an answer to a sent quote, into triage."""
    email: str = db.value(
        "insert into crm.emails (customer_id, message_id, direction, from_address, from_name, "
        "subject, body_text, sent_at, folder) values (%s, gen_random_uuid()::text, 'in', %s, "
        "'Erika Korn', 'Re: Angebot', 'Wir nehmen Ihr Angebot an.', now(), 'INBOX') returning id",
        (customer, address),
        SERVICE,
    )
    row: str = db.value(
        "insert into crm.mail_triage (kind, status, direction, address, name, subject, body_text, "
        "folder, email_id, customer_id, sender_verified) values ('customer_mail', 'queued', 'in', "
        "%s, 'Erika Korn', 'Re: Angebot', 'Wir nehmen Ihr Angebot an.', 'INBOX', %s, %s, %s) "
        "returning id",
        (address, email, customer, verified),
        SERVICE,
    )
    return row


def park_unknown_sender(db: Database, address: str, name: str) -> str:
    """Triage queue: the first mail of an unknown address waits for the server worker."""
    row: str = db.value(
        "insert into crm.mail_triage (id, kind, status, direction, address, name, subject, "
        "body_text, folder, raw_path) select id, 'unknown_sender', 'queued', 'in', %s, %s, "
        "'Anfrage Webseite', 'Können Sie unsere Webseite verbessern?', 'INBOX', "
        "'triage/' || id || '.eml' from (select gen_random_uuid() as id) fresh returning id",
        (address, name),
        SERVICE,
    )
    return row


def apply_unknown_verdicts(db: Database) -> list[str]:
    """applyVerdicts: classified customers are taken in, every row is marked applied.

    Returns:
        Ids of the customers taken in.
    """
    taken_in: list[str] = []
    rows = db.rows(
        "select id, status, address, name, subject, body_text, result from crm.mail_triage "
        "where kind = 'unknown_sender' and status in ('classified', 'failed') order by created_at",
        caller=SERVICE,
    )
    for row in rows:
        result = row["result"] or {}
        if row["status"] == "classified" and result.get("verdict") == "customer":
            taken_in.append(
                db.value(
                    "select crm.intake_contact(p_channel => 'email', p_email => %s, p_name => %s, "
                    "p_company => %s, p_phone => '', p_subject => %s, p_message => %s)",
                    (
                        row["address"],
                        result.get("name") or row["name"],
                        result.get("company", ""),
                        row["subject"],
                        row["body_text"],
                    ),
                    SERVICE,
                )
            )
        else:
            _review(db, row)
        db.run(
            "update crm.mail_triage set status = 'applied', applied_at = now() where id = %s",
            (row["id"],),
            SERVICE,
        )
    return taken_in


def _review(db: Database, row: dict[str, Any]) -> None:
    """A verdict other than customer, or a row failed for good, lands on Daniel's review list."""
    result = row["result"] or {}
    verdict = result.get("verdict") if row["status"] == "classified" else "unsure"
    db.run(
        "insert into crm.mail_review (address, name, company, direction, subject, snippet, "
        "sent_at, mail_count, verdict, reason) values (%s, %s, %s, 'in', %s, %s, now(), 1, %s, %s) "
        "on conflict (address) do nothing",
        (
            row["address"],
            result.get("name") or row["name"],
            result.get("company", ""),
            row["subject"],
            row["body_text"],
            verdict if verdict != "customer" else "unsure",
            result.get("reason", ""),
        ),
        SERVICE,
    )


def _attachment(mail: dict[str, Any]) -> tuple[str, str, str] | None:
    """Document kind, id column and id of the PDF the worker attaches, as in Attachments.prepare."""
    if mail["kind"] == "contract" and mail["contract_id"] is not None:
        return ("contract", "contract_id", mail["contract_id"])
    if mail["kind"] == "quote":
        return ("quote", "quote_id", mail["quote_id"])
    if mail["kind"] == "invoice":
        return ("invoice", "invoice_id", mail["invoice_id"])
    if mail["kind"] == "dunning":
        return ("other", "invoice_id", mail["invoice_id"])
    return None


def _store_pdf(db: Database, mail: dict[str, Any]) -> str | None:
    attachment = _attachment(mail)
    if attachment is None:
        return None
    kind, column, owner = attachment
    path = f"customers/{mail['customer_id']}/{kind}/{mail['id']}.pdf"
    insert = (
        "insert into crm.documents (customer_id, kind, title, file_path, source, mime_type, "
        f"size_bytes, {column}) values (%s, %s, %s, %s, 'generated', 'application/pdf', 1000, %s) "
        "on conflict (file_path) do nothing"
    )
    db.run(
        insert.encode(), (mail["customer_id"], kind, f"{mail['subject']}.pdf", path, owner), SERVICE
    )
    return path


def send_outbox(db: Database) -> list[str]:
    """sendOutbox: attach the PDF, send, mark sent, file the mail and log it.

    Returns:
        Subjects of the mails sent, in sending order.
    """
    mails = db.rows(
        "select id, customer_id, to_address, subject, body, kind, contract_id, quote_id, "
        "invoice_id, dunning_level, attempts, created_at from crm.outbox where status = 'queued' "
        "order by created_at limit 25",
        caller=SERVICE,
    )
    for mail in mails:
        path = _store_pdf(db, mail)
        db.run(
            "update crm.outbox set status = 'sent', sent_at = now(), error = '', "
            "attachment_path = %s where id = %s",
            (path, mail["id"]),
            SERVICE,
        )
        _record_sent(db, mail)
    return [mail["subject"] for mail in mails]


def _record_sent(db: Database, mail: dict[str, Any]) -> None:
    db.run(
        "insert into crm.emails (customer_id, message_id, direction, from_address, from_name, "
        "to_addresses, subject, body_text, sent_at, folder, has_attachments) values (%s, %s, "
        "'out', %s, 'Daniel Hütte', array[%s], %s, %s, now(), 'CRM', true) "
        "on conflict (message_id) do nothing",
        (
            mail["customer_id"],
            f"<{mail['id']}@repocity>",
            MAILBOX,
            mail["to_address"],
            mail["subject"],
            mail["body"],
        ),
        SERVICE,
    )
    if mail["kind"] == "contract" and mail["contract_id"] is not None:
        db.run(
            "update crm.contracts set status = 'sent', sent_at = now() where id = %s",
            (mail["contract_id"],),
            SERVICE,
        )
    db.run(
        "insert into crm.activities (customer_id, kind, body, actor) values (%s, 'email', %s, "
        "'Postfach')",
        (mail["customer_id"], f"„{mail['subject']}“ per E-Mail an {mail['to_address']} gesendet."),
        SERVICE,
    )


def fail_outbox(db: Database, mail: str, error: str) -> str:
    """MarkFailed after one more failed try: queued again below three tries, else failed."""
    attempts: int = db.value("select attempts from crm.outbox where id = %s", (mail,), SERVICE)
    status = "failed" if attempts + 1 >= 3 else "queued"
    db.run(
        "update crm.outbox set attempts = %s, status = %s, error = %s where id = %s",
        (attempts + 1, status, error, mail),
        SERVICE,
    )
    return status


def render_missing_invoice_pdfs(db: Database) -> int:
    """renderMissingInvoices: every finalised invoice without an invoice PDF gets one."""
    missing = db.rows(
        "select i.id, i.customer_id, i.number from crm.invoices i where i.status in "
        "('open', 'paid', 'cancelled') and not exists (select 1 from crm.documents d "
        "where d.kind = 'invoice' and d.invoice_id = i.id) order by i.finalized_at",
        caller=SERVICE,
    )
    for invoice in missing:
        db.run(
            "insert into crm.documents (customer_id, kind, title, file_path, source, mime_type, "
            "size_bytes, invoice_id) values (%s, 'invoice', %s, %s, 'generated', "
            "'application/pdf', 1000, %s) on conflict (file_path) do nothing",
            (
                invoice["customer_id"],
                f"Rechnung {invoice['number']}.pdf",
                f"customers/{invoice['customer_id']}/rechnungen/{invoice['number']}.pdf",
                invoice["id"],
            ),
            SERVICE,
        )
    return len(missing)


# Server worker (RadarAuditor container, service key)


def server_classifies(db: Database, results: dict[str, dict[str, Any]]) -> list[str]:
    """Idle poll: claim waiting mails and hand Claude Code's answer, by address, to the CRM.

    Returns:
        Statuses of the claimed rows after classification, in claim order.
    """
    claimed = db.rows(
        "select * from crm.claim_mail_triage(p_limit => 5, p_seconds => 600)", caller=SERVICE
    )
    statuses: list[str] = []
    for row in claimed:
        classified = db.one(
            "select status from crm.classify_mail_triage(p_id => %s, p_result => %s::jsonb)",
            (row["id"], json.dumps(results[row["address"]])),
            SERVICE,
        )
        statuses.append(classified["status"])
    return statuses


def server_fails(db: Database, error: str) -> list[str]:
    """Idle poll whose Claude Code call fails for every claimed mail."""
    claimed = db.rows(
        "select * from crm.claim_mail_triage(p_limit => 5, p_seconds => 600)", caller=SERVICE
    )
    return [
        db.one(
            "select status from crm.fail_mail_triage(p_id => %s, p_error => %s)",
            (row["id"], error),
            SERVICE,
        )["status"]
        for row in claimed
    ]


# Phone agent (telefon/, service key)


def phone_intake(db: Database, number: str | None, name: str, email: str = "") -> str:
    """crm.intake_call after the caller asked for something new."""
    customer: str = db.value(
        "select crm.intake_call(p_caller_number => %s, p_name => %s, p_company => '', "
        "p_email => %s, p_subject => 'Neue Webseite', p_message => 'Bitte um Rückruf.')",
        (number, name, email),
        SERVICE,
    )
    return customer


def phone_decision(db: Database, number: str | None, quote_number: str | None, intent: str) -> Any:
    """crm.phone_quote_decision after the caller accepted or declined a quote."""
    return db.value(
        "select crm.phone_quote_decision(p_caller_number => %s, p_quote_number => %s, "
        "p_intent => %s, p_summary => 'Entscheidung am Telefon')",
        (number, quote_number, intent),
        SERVICE,
    )


def phone_record(db: Database, number: str | None, outcome: str, customer: str | None) -> str:
    """crm.record_call once the call ended."""
    call = {
        "caller_number": number,
        "customer_id": customer,
        "started_at": "2026-10-25T10:00:00+02:00",
        "ended_at": "2026-10-25T10:04:00+02:00",
        "transcript": [{"speaker": "caller", "text": "Guten Tag."}],
        "summary": "Gespräch am Telefon",
        "outcome": outcome,
    }
    call_id: str = db.value(
        "select crm.record_call(p_call => %s::jsonb)", (json.dumps(call),), SERVICE
    )
    return call_id


# RadarAuditor app (signed-in administrator) and worker (service key)


def field_audit(db: Database, website: str, name: str, city: str) -> str:
    """public.start_field_audit from the field app.

    Returns:
        Id of the CRM customer the audit is linked to.
    """
    audit: str = db.value(
        "select public.start_field_audit(p_website => %s, p_name => %s, p_city => %s, "
        "p_industry => 'Bäckerei')",
        (website, name, city),
        ADMIN,
    )
    crm_customer: str = db.value(
        "select c.crm_customer_id from public.audits a join public.customers c "
        "on c.id = a.customer_id where a.id = %s",
        (audit,),
    )
    return crm_customer


def report_audit(db: Database, audit: str, status: str, score: float | None) -> None:
    """The worker's report step: the audit is reported with its score, or failed."""
    db.run(
        "update public.audits set status = %s::public.audit_status, total_score = %s, "
        "error = case when %s = 'failed' then 'Webseite nicht erreichbar' end where id = %s",
        (status, score, status, audit),
        SERVICE,
    )


def save_crm_email(db: Database, customer: str, email: str) -> None:
    """SaveCrmCustomerEmail in the quote screen of the RadarAuditor app."""
    db.run(
        "update crm.customers set email = %s where id = %s returning id",
        (email.lower(), customer),
        ADMIN,
    )


def radar_quote(db: Database, customer: str, items: list[tuple[str, str, str, float]]) -> str:
    """createQuote: crm.create_quote, the items, then intro and outro.

    Args:
        db: Test database.
        customer: CRM customer.
        items: Product id, title, unit and net price per item.
    """
    quote: str = db.value("select (crm.create_quote(p_customer => %s)).id", (customer,), ADMIN)
    for position, (product, title, unit, price) in enumerate(items, start=1):
        db.run(
            "insert into crm.quote_items (quote_id, position, product_id, title, unit, "
            "unit_price_net, vat_rate) values (%s, %s, %s, %s, %s, %s, 19)",
            (quote, position, product, title, unit, price),
            ADMIN,
        )
    db.run(
        "update crm.quotes set intro = 'Nach der Prüfung Ihrer Webseite biete ich an:', "
        "outro = 'Ich freue mich auf Ihre Rückmeldung.' where id = %s",
        (quote,),
        ADMIN,
    )
    return quote


def start_optimization(db: Database, order: str) -> str:
    """public.start_optimization from the order screen of the RadarAuditor app."""
    job: str = db.value("select public.start_optimization(p_order_id => %s)", (order,), ADMIN)
    return job


def worker_drafts(db: Database, job: str, targets: list[str]) -> list[str]:
    """The optimize job stores its drafts and finishes; no draft means nothing to change."""
    order: str = db.value("select order_id from public.jobs where id = %s", (job,), SERVICE)
    db.run("update public.jobs set status = 'running' where id = %s", (job,), SERVICE)
    drafts = [
        db.value(
            "insert into public.optimization_changes (order_id, target, after) "
            "values (%s, %s, 'neuer Text') returning id",
            (order, target),
            SERVICE,
        )
        for target in targets
    ]
    db.run("update public.jobs set status = 'done' where id = %s", (job,), SERVICE)
    return drafts


def decide_change(db: Database, change: str, approve: bool) -> None:
    """public.decide_change from the RadarAuditor app."""
    db.run(
        "select public.decide_change(p_change_id => %s, p_approve => %s)", (change, approve), ADMIN
    )


def worker_applies(db: Database, outcomes: dict[str, str]) -> None:
    """The apply job records each approved change's outcome, then finishes."""
    job: str = db.value(
        "select id from public.jobs where kind = 'apply' and status = 'queued'", caller=SERVICE
    )
    db.run("update public.jobs set status = 'running' where id = %s", (job,), SERVICE)
    for change, status in outcomes.items():
        error = {"manual": "Manuell umsetzen: im Theme eintragen", "failed": "Zugang abgelehnt"}
        db.run(
            "update public.optimization_changes "
            "set status = %s::public.optimization_change_status, "
            "error = %s where id = %s and status = 'approved'",
            (status, error.get(status), change),
            SERVICE,
        )
    db.run("update public.jobs set status = 'done' where id = %s", (job,), SERVICE)


def mark_manual_done(db: Database, change: str) -> None:
    """public.mark_manual_done when Daniel ticks a change off in the RadarAuditor app."""
    db.run("select public.mark_manual_done(p_change_id => %s, p_done => true)", (change,), ADMIN)


# Cockpit (lock screen, anon key with the message token)


def tap(db: Database, kind: str, action: str, newest: bool = True) -> Any:
    """One tap on a button of the newest (or oldest) notice of a kind on the lock screen."""
    order = "desc" if newest else "asc"
    notice = db.one(
        f"select id, action_token from cockpit.messages where kind = %s "
        f"order by created_at {order} limit 1".encode(),
        (kind,),
    )
    return db.value(
        "select cockpit.run_action(p_message => %s, p_token => %s, p_action => %s)",
        (notice["id"], notice["action_token"], action),
        ANON,
    )


# Audit request form of the website (anon key, repocity-seite)


def audit_slots(db: Database, kind: str) -> list[Any]:
    """crm.audit_slots as the form loads the free hours for the chosen kind of meeting."""
    return [
        row["starts_at"]
        for row in db.rows("select starts_at from crm.audit_slots(p_kind => %s)", (kind,), ANON)
    ]


def audit_form(db: Database, kind: str, starts_at: Any, **fields: Any) -> Any:
    """crm.request_audit as the form sends it; fields replace the defaults of a bakery."""
    params = {
        "p_company": "Bäckerei Korn",
        "p_contact": "Erika Korn",
        "p_email": "info@baeckerei-korn.de",
        "p_phone": "0251 123456",
        "p_website": "baeckerei-korn.de",
        "p_address": "Ludgeristraße 1, 48143 Münster",
        "p_kind": kind,
        "p_starts_at": starts_at,
        "p_message": "Wir möchten bei Google besser gefunden werden.",
        "p_utm_source": "linkedin",
        "p_utm_medium": "social",
        "p_utm_campaign": "sichtbarkeit-muenster",
        "p_request_key": None,
        **fields,
    }
    names = ", ".join(f"{key} => %({key})s" for key in params)
    return db.value(f"select crm.request_audit({names})".encode(), params, ANON)


# Appointment page (Edge Function crm-termin, service key)


def offer_page(db: Database, token: Any) -> Any:
    """GET of a proposal link: what the page shows, changes nothing."""
    return db.value("select crm.audit_offer_view(p_token => %s)", (token,), SERVICE)


def book_offer(db: Database, token: Any) -> Any:
    """POST of the button „Diesen Termin buchen“."""
    return db.value("select crm.book_audit_offer(p_token => %s)", (token,), SERVICE)


def reschedule_page(db: Database, token: Any) -> Any:
    """GET of the link „Anderen Termin wünschen“ in a confirmation."""
    return db.value("select crm.audit_reschedule_view(p_token => %s)", (token,), SERVICE)


def ask_reschedule(db: Database, token: Any) -> Any:
    """POST of the button „Anderen Termin wünschen“."""
    return db.value("select crm.request_audit_reschedule(p_token => %s)", (token,), SERVICE)
