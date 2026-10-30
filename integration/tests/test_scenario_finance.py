"""Scenarios F1-F16: bank statements, incoming payments, expenses, receipts, profit and dunning.

Context: Daniel uploads the CAMT.053 file of his business account in the CRM page "Finanzen"; the
database reads it, books incoming payments whose invoice number and amount fit, asks in the Cockpit
about the rest, turns debits into expenses and sends reminders without approval while the bank data
is current (migration crm/007_finanzen.sql). | Input: statements built here after ISO 20022
camt.053.001.02 (the version of the German banks) and camt.053.001.08, an accepted order from
steps.py. | Output: Assertions on bank transactions, payments, invoices, approvals, expenses,
receipts, the profit per month, outbox and Cockpit.
"""

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any
from xml.sax.saxutils import escape

import psycopg
import pytest
from actors import send_outbox, start_optimization, tap, worker_drafts
from steps import accepted_order

from repocity_integration.database import ADMIN, READER, SERVICE, Database

IBAN = "DE02120300000000202051"
OTHER_IBAN = "DE89370400440532013000"
V02 = "urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"
V08 = "urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"
# The day of the database, which runs in UTC as the live project does.
TODAY = datetime.now(UTC).date()


@dataclass
class Tx:
    """One transaction of an entry: who, which account, what reference, which amount when split."""

    name: str = ""
    iban: str = ""
    purpose: str = ""
    amount: Decimal | None = None
    direct: bool = False
    e2e: str = ""
    returned: bool = False
    side: str | None = None


@dataclass
class Entry:
    """One booked entry of the statement."""

    amount: Decimal
    direction: str
    booked: date = TODAY
    reference: str | None = None
    status: str | None = "BOOK"
    currency: str = "EUR"
    reversal: bool = False
    family: str | None = None
    proprietary: str | None = None
    txs: list[Tx] = field(default_factory=list[Tx])


def _party(direction: str, tx: Tx, version: str) -> str:
    side = tx.side or ("Dbtr" if direction == "CRDT" else "Cdtr")
    who, account = side, f"{side}Acct"
    name = f"<Nm>{escape(tx.name)}</Nm>"
    if version == V08:
        name = f"<Pty>{name}</Pty>"
    iban = f"<{account}><Id><IBAN>{tx.iban}</IBAN></Id></{account}>" if tx.iban else ""
    return f"<RltdPties><{who}>{name}</{who}>{iban}</RltdPties>"


def _family(code: str | None, proprietary: str | None) -> str:
    """Bank transaction code of the entry: ISO sub-family and the bank's own code.

    German banks fill the own code with the business transaction code (GVC).
    """
    if code is None and proprietary is None:
        return ""
    domain = (
        ""
        if code is None
        else f"<Domn><Cd>PMNT</Cd><Fmly><Cd>ICDT</Cd><SubFmlyCd>{code}</SubFmlyCd></Fmly></Domn>"
    )
    own = (
        ""
        if proprietary is None
        else f"<Prtry><Cd>{escape(proprietary)}</Cd><Issr>DK</Issr></Prtry>"
    )
    return f"<BkTxCd>{domain}{own}</BkTxCd>"


def _entry(entry: Entry, version: str) -> str:
    status = (
        ""
        if entry.status is None
        else f"<Sts><Cd>{entry.status}</Cd></Sts>"
        if version == V08
        else f"<Sts>{entry.status}</Sts>"
    )
    reference = f"<AcctSvcrRef>{entry.reference}</AcctSvcrRef>" if entry.reference else ""
    details = "".join(
        "<TxDtls>"
        + (f"<Refs><EndToEndId>{escape(tx.e2e)}</EndToEndId></Refs>" if tx.e2e else "")
        + (
            ""
            if tx.amount is None
            else f'<Amt Ccy="EUR">{tx.amount}</Amt>'
            if tx.direct
            else f'<AmtDtls><TxAmt><Amt Ccy="EUR">{tx.amount}</Amt></TxAmt></AmtDtls>'
        )
        + _party(entry.direction, tx, version)
        + f"<RmtInf><Ustrd>{escape(tx.purpose)}</Ustrd></RmtInf>"
        + ("<RtrInf><Rsn><Cd>AC04</Cd></Rsn></RtrInf>" if tx.returned else "")
        + "</TxDtls>"
        for tx in entry.txs
    )
    return (
        f'<Ntry><Amt Ccy="{entry.currency}">{entry.amount}</Amt>'
        f"<CdtDbtInd>{entry.direction}</CdtDbtInd>"
        f"{'<RvslInd>true</RvslInd>' if entry.reversal else ''}"
        f"{status}<BookgDt><Dt>{entry.booked}</Dt></BookgDt><ValDt><Dt>{entry.booked}</Dt></ValDt>"
        f"{reference}{_family(entry.family, entry.proprietary)}"
        f"<NtryDtls>{details}</NtryDtls></Ntry>"
    )


def statement(
    entries: list[Entry],
    iban: str = IBAN,
    version: str = V02,
    until: date | None = TODAY,
) -> str:
    """A camt.053 document with one statement of the account over the given entries."""
    period = (
        f"<FrToDt><FrDtTm>{TODAY - timedelta(days=30)}T00:00:00</FrDtTm>"
        f"<ToDtTm>{until}T23:59:59</ToDtTm></FrToDt>"
        if until is not None
        else ""
    )
    body = "".join(_entry(entry, version) for entry in entries)
    return (
        f'<?xml version="1.0" encoding="UTF-8"?><Document xmlns="{version}"><BkToCstmrStmt>'
        f"<GrpHdr><MsgId>M1</MsgId><CreDtTm>{TODAY}T08:00:00</CreDtTm></GrpHdr>"
        f"<Stmt><Id>S1</Id>{period}<Acct><Id><IBAN>{iban}</IBAN></Id></Acct>{body}</Stmt>"
        "</BkToCstmrStmt></Document>"
    )


def incoming(
    amount: Decimal | float, purpose: str, name: str = "Bäckerei Korn", **kw: Any
) -> Entry:
    return Entry(Decimal(str(amount)), "CRDT", txs=[Tx(name, OTHER_IBAN, purpose)], **kw)


def outgoing(amount: Decimal | float, name: str, purpose: str, **kw: Any) -> Entry:
    return Entry(Decimal(str(amount)), "DBIT", txs=[Tx(name, "", purpose)], **kw)


def upload(db: Database, xml: str, name: str = "auszug.xml") -> dict[str, int]:
    """What the page does when Daniel picks the file: the import as the administrator."""
    result: dict[str, int] = db.value(
        "select crm.import_bank_statement(%s, %s)", (name, xml), ADMIN
    )
    return result


def _invoice(db: Database) -> dict[str, Any]:
    ids = accepted_order(db)
    db.run("update crm.subscriptions set next_invoice_date = current_date + 30")
    worker_drafts(db, start_optimization(db, ids["order"]), [])
    send_outbox(db)
    invoice = db.one("select id, number, gross from crm.invoices")
    return {**ids, "invoice": invoice["id"], "number": invoice["number"], "gross": invoice["gross"]}


def _invoice_status(db: Database, invoice: str) -> tuple[str, Decimal]:
    row = db.one("select status, paid_amount from crm.invoices where id = %s", (invoice,))
    return row["status"], row["paid_amount"]


def _routine(db: Database) -> None:
    db.run("select crm.daily_routine()", caller=SERVICE)


def _overdue(db: Database, days: int) -> None:
    db.run(
        "set session_replication_role = replica; "
        f"update crm.invoices set due_date = due_date - {days}; "
        "set session_replication_role = origin".encode()
    )


def test_f1_number_and_amount_fit_so_the_invoice_is_paid_by_itself(db: Database) -> None:
    ids = _invoice(db)

    result = upload(
        db, statement([incoming(ids["gross"], f"Rechnung {ids['number']} danke", reference="R1")])
    )

    assert result == {
        "entries": 1,
        "new": 1,
        "skipped": 0,
        "paid": 1,
        "suggested": 0,
        "open": 0,
        "expenses": 0,
        "reversals": 0,
    }
    assert _invoice_status(db, ids["invoice"]) == ("paid", ids["gross"])
    payment = db.one(
        "select paid_on, method from crm.payments where invoice_id = %s", (ids["invoice"],)
    )
    assert (payment["paid_on"], payment["method"]) == (TODAY, "transfer")
    tx = db.one(
        "select status, invoice_id, payment_id is not null as linked from crm.bank_transactions"
    )
    assert (tx["status"], tx["invoice_id"], tx["linked"]) == ("paid", ids["invoice"], True)
    assert db.value("select count(*) from crm.approvals where kind = 'payment'") == 0


def test_f2_the_same_file_twice_adds_nothing(db: Database) -> None:
    ids = _invoice(db)
    xml = statement(
        [
            incoming(ids["gross"], ids["number"], reference="R1"),
            outgoing(12.5, "Hetzner Online GmbH", "Server"),
        ]
    )

    upload(db, xml)
    again = upload(db, xml)

    assert again == {
        "entries": 2,
        "new": 0,
        "skipped": 0,
        "paid": 0,
        "suggested": 0,
        "open": 0,
        "expenses": 0,
        "reversals": 0,
    }
    assert db.value("select count(*) from crm.bank_transactions") == 2
    assert db.value("select count(*) from crm.payments") == 1
    assert db.value("select count(*) from crm.expenses") == 1


def test_f3_number_with_another_amount_waits_for_a_tap_and_books_the_part(db: Database) -> None:
    ids = _invoice(db)

    result = upload(
        db, statement([incoming(100, f"{ids['number'].replace('-', ' ')} Teilzahlung")])
    )
    answer = tap(db, "freigabe", "approve")

    assert result["suggested"] == 1
    assert answer == {"ok": True, "text": "Freigabe erteilt."}
    assert _invoice_status(db, ids["invoice"]) == ("open", Decimal("100.00"))
    assert db.value("select status from crm.bank_transactions") == "paid"
    assert (
        db.value("select link from cockpit.messages where kind = 'freigabe'")
        == "https://crm.speedofthespirit.dev/finanzen"
    )


def test_f4_amount_without_number_is_a_suggestion_and_rejecting_leaves_it_open(
    db: Database,
) -> None:
    ids = _invoice(db)

    upload(db, statement([incoming(ids["gross"], "Danke für die schnelle Hilfe")]))
    approval = db.one("select title, invoice_id from crm.approvals where kind = 'payment'")
    answer = tap(db, "freigabe", "reject")

    assert approval["invoice_id"] == ids["invoice"]
    assert approval["title"].startswith("Zahlung ")
    assert answer == {"ok": True, "text": "Freigabe abgelehnt."}
    assert db.value("select status from crm.bank_transactions") == "open"
    assert _invoice_status(db, ids["invoice"]) == ("open", Decimal("0.00"))


def test_f5_an_unknown_payment_is_reported_and_can_be_other_income(db: Database) -> None:
    _invoice(db)

    upload(db, statement([incoming(42, "Erstattung", name="Finanzamt Münster")]))
    tx: str = db.value("select id from crm.bank_transactions")
    notice = db.one(
        "select title, link from cockpit.messages where kind = 'zahlung' "
        "order by created_at desc limit 1"
    )
    db.run("select crm.classify_incoming(%s, 'other_income')", (tx,), ADMIN)

    assert notice == {
        "title": "Zahlungseingang ohne Rechnung: 42,00 €",
        "link": "https://crm.speedofthespirit.dev/finanzen",
    }
    month = db.one(
        "select income, expenses, profit from crm.profit_by_month(current_date, current_date)"
    )
    assert month == {
        "income": Decimal("42.00"),
        "expenses": Decimal("0"),
        "profit": Decimal("42.00"),
    }


def test_f6_an_account_chosen_once_is_used_for_the_next_expense_of_that_payee(db: Database) -> None:
    db.run("update crm.settings set iban = %s", (IBAN,))
    upload(db, statement([outgoing(19.99, "Anthropic, PBC", "Abo Oktober", reference="A1")]))
    expense: str = db.value("select id from crm.expenses")
    assert db.value("select account from crm.expenses") is None

    db.run("select crm.set_expense_account(%s, '4964', 19)", (expense,), ADMIN)
    upload(db, statement([outgoing(19.99, "ANTHROPIC PBC", "Abo November", reference="A2")]))

    assert db.rows("select account, vat_rate from crm.expenses order by purpose") == [
        {"account": "4964", "vat_rate": Decimal("0.00")},
        {"account": "4964", "vat_rate": Decimal("19.00")},
    ]


def test_f7_private_withdrawals_do_not_lower_the_profit(db: Database) -> None:
    db.run("update crm.settings set iban = %s", (IBAN,))
    upload(
        db,
        statement(
            [outgoing(500, "Daniel Hütte", "Privat"), outgoing(30, "Hetzner Online GmbH", "Server")]
        ),
    )
    private: str = db.value("select id from crm.expenses where counterparty = 'Daniel Hütte'")
    server: str = db.value("select id from crm.expenses where counterparty = 'Hetzner Online GmbH'")

    db.run("select crm.set_expense_account(%s, '1800')", (private,), ADMIN)
    db.run("select crm.set_expense_account(%s, '4806')", (server,), ADMIN)

    month = db.one(
        "select income, expenses, unassigned, profit "
        "from crm.profit_by_month(current_date, current_date)"
    )
    assert month == {
        "income": Decimal("0"),
        "expenses": Decimal("30.00"),
        "unassigned": Decimal("0"),
        "profit": Decimal("-30.00"),
    }
    assert (
        db.value("select status from crm.bank_transactions where counterparty = 'Daniel Hütte'")
        == "private"
    )


def test_f8_a_statement_of_another_account_or_without_settings_is_refused(db: Database) -> None:
    with pytest.raises(psycopg.errors.RaiseException, match="IBAN des Geschäftskontos"):
        upload(db, statement([outgoing(5, "X", "Y")]))
    db.run("update crm.settings set iban = 'DE02 1203 0000 0000 2020 51'")
    with pytest.raises(psycopg.errors.RaiseException, match="gehört zum Konto"):
        upload(db, statement([outgoing(5, "X", "Y")], iban=OTHER_IBAN))

    assert db.value("select count(*) from crm.bank_transactions") == 0
    assert db.value("select count(*) from crm.bank_imports") == 0


def test_f9_version_08_split_entries_and_identical_twins_are_kept_apart(db: Database) -> None:
    db.run("update crm.settings set iban = %s", (IBAN,))
    batch = Entry(
        Decimal("30.00"),
        "DBIT",
        reference="B1",
        txs=[
            Tx("Telekom", "", "Rechnung Telefon", Decimal("20.00")),
            Tx("Post", "", "Briefmarken", Decimal("10.00")),
        ],
    )
    twins = [outgoing(4.99, "Kiosk", "Kaffee"), outgoing(4.99, "Kiosk", "Kaffee")]
    xml = statement([batch, *twins], version=V08)

    first = upload(db, xml)
    second = upload(db, xml)

    assert (first["new"], first["expenses"], second["new"]) == (4, 4, 0)
    assert db.rows(
        "select counterparty, amount from crm.bank_transactions order by amount desc, counterparty"
    ) == [
        {"counterparty": "Telekom", "amount": Decimal("20.00")},
        {"counterparty": "Post", "amount": Decimal("10.00")},
        {"counterparty": "Kiosk", "amount": Decimal("4.99")},
        {"counterparty": "Kiosk", "amount": Decimal("4.99")},
    ]


def test_f10_pending_and_foreign_currency_entries_are_skipped(db: Database) -> None:
    db.run("update crm.settings set iban = %s", (IBAN,))

    result = upload(
        db,
        statement(
            [
                outgoing(5, "A", "vorgemerkt", status="PDNG"),
                outgoing(5, "B", "Dollar", currency="USD"),
            ]
        ),
    )

    assert (result["entries"], result["skipped"], result["new"]) == (2, 2, 0)


def test_f11_a_file_with_a_doctype_or_not_camt_is_refused(db: Database) -> None:
    db.run("update crm.settings set iban = %s", (IBAN,))
    with pytest.raises(psycopg.errors.RaiseException, match="kein Kontoauszug"):
        upload(
            db,
            '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>',
        )
    with pytest.raises(psycopg.errors.RaiseException, match="kein Kontoauszug"):
        upload(db, "<Document><Something/></Document>")
    with pytest.raises(psycopg.errors.RaiseException, match="kein lesbares XML"):
        upload(db, "<Document>")


def test_f12_with_current_bank_data_a_reminder_goes_out_without_a_tap(db: Database) -> None:
    ids = _invoice(db)
    upload(db, statement([outgoing(5, "Bank", "Kontoführung")]))
    _overdue(db, 20)

    _routine(db)

    assert db.value("select count(*) from crm.approvals where kind = 'dunning'") == 0
    assert db.rows("select dunning_level, approval_id from crm.outbox where kind = 'dunning'") == [
        {"dunning_level": 1, "approval_id": None}
    ]
    assert db.value("select dunning_level from crm.invoices where id = %s", (ids["invoice"],)) == 1


def test_f13_old_bank_data_or_an_unclear_payment_keeps_the_tap(db: Database) -> None:
    _invoice(db)
    upload(db, statement([outgoing(5, "Bank", "Kontoführung")], until=TODAY - timedelta(days=5)))
    _overdue(db, 20)
    _routine(db)
    assert db.value("select count(*) from crm.approvals where kind = 'dunning'") == 1

    db.run("update crm.approvals set status = 'rejected' where kind = 'dunning'")
    db.run("update crm.invoices set last_dunning_at = null")
    upload(db, statement([incoming(1, "unbekannt", name="Jemand", reference="U1")]))
    _routine(db)
    assert (
        db.value("select count(*) from crm.approvals where kind = 'dunning' and status = 'pending'")
        == 1
    )


def test_f14_a_customer_without_address_falls_back_to_the_tap(db: Database) -> None:
    ids = _invoice(db)
    db.run("update crm.customers set email = '' where id = %s", (ids["customer"],))
    upload(db, statement([outgoing(5, "Bank", "Kontoführung")]))
    _overdue(db, 20)

    _routine(db)

    assert db.value("select count(*) from crm.approvals where kind = 'dunning'") == 1
    assert db.value("select count(*) from crm.outbox where kind = 'dunning'") == 0


def test_f15_receipts_stay_and_fix_amount_date_and_payee(db: Database) -> None:
    expense: str = db.value(
        "select (crm.add_cash_expense(current_date, 23.80, 'Bürohaus', 'Papier', '4930', 19)).id",
        caller=ADMIN,
    )
    path = f"belege/{expense}/quittung.pdf"
    db.run(
        "select crm.add_receipt(%s, %s, 'quittung.pdf', 'application/pdf', 1200)",
        (expense, path),
        ADMIN,
    )

    with pytest.raises(psycopg.errors.RaiseException, match="zehn Jahre"):
        db.run("delete from crm.receipts", caller=ADMIN)
    with pytest.raises(psycopg.errors.RaiseException, match="bleiben, wie sie sind"):
        db.run("update crm.expenses set amount = 1 where id = %s", (expense,), ADMIN)
    with pytest.raises(psycopg.errors.RaiseException, match="nicht bei dieser Ausgabe"):
        db.run(
            "select crm.add_receipt(%s, 'belege/x/y.pdf', 'y.pdf', 'application/pdf', 1)",
            (expense,),
            ADMIN,
        )
    db.run("select crm.set_expense_account(%s, '4940')", (expense,), ADMIN)
    assert db.value("select account from crm.expenses") == "4940"


def test_f16_profit_per_month_matches_a_count_by_hand(db: Database) -> None:
    ids = _invoice(db)
    last_month = (TODAY.replace(day=1) - timedelta(days=1)).replace(day=15)
    upload(
        db,
        statement(
            [
                incoming(ids["gross"], ids["number"], reference="P1"),
                outgoing(30, "Hetzner Online GmbH", "Server", reference="E1"),
                outgoing(12, "Unbekannt", "Lastschrift", reference="E2"),
                outgoing(
                    50, "Hetzner Online GmbH", "Server alt", booked=last_month, reference="E3"
                ),
            ]
        ),
    )
    db.run(
        "select crm.add_cash_expense(current_date, 8, 'Kiosk', 'Briefmarken', '4910')", caller=ADMIN
    )
    hetzner: str = db.value("select id from crm.expenses where purpose = 'Server'")
    db.run("select crm.set_expense_account(%s, '4806')", (hetzner,), ADMIN)

    months = db.rows(
        "select month, income, expenses, unassigned, profit "
        "from crm.profit_by_month(%s, current_date)",
        (last_month,),
    )

    assert months == [
        {
            "month": last_month.replace(day=1),
            "income": Decimal("0"),
            "expenses": Decimal("50.00"),
            "unassigned": Decimal("0"),
            "profit": Decimal("-50.00"),
        },
        {
            "month": TODAY.replace(day=1),
            "income": ids["gross"],
            "expenses": Decimal("50.00"),
            "unassigned": Decimal("12.00"),
            "profit": ids["gross"] - 50,
        },
    ]


def test_f17_only_the_administrator_reads_a_statement(db: Database) -> None:
    db.run("update crm.settings set iban = %s", (IBAN,))
    with pytest.raises(psycopg.errors.RaiseException, match="Nur der Administrator"):
        db.value(
            "select crm.import_bank_statement('a.xml', %s)",
            (statement([outgoing(5, "A", "B")]),),
            READER,
        )
    assert db.value("select count(*) from crm.bank_transactions", caller=READER) == 0


def test_f18_placeholder_references_do_not_swallow_bookings(db: Database) -> None:
    ids = _invoice(db)
    first = statement(
        [
            outgoing(10, "Hetzner Online GmbH", "Server", reference="NONREF"),
            outgoing(20, "Telekom", "Telefon", reference="NONREF"),
        ]
    )
    later = statement([incoming(ids["gross"], ids["number"], reference="NONREF")])

    assert upload(db, first)["new"] == 2
    assert upload(db, later)["paid"] == 1
    assert _invoice_status(db, ids["invoice"])[0] == "paid"


def test_f19_a_payment_entered_by_hand_is_linked_not_counted_twice(db: Database) -> None:
    ids = _invoice(db)
    db.run(
        "select crm.record_payment(%s, %s, current_date, 'transfer', 'Überweisung')",
        (ids["invoice"], ids["gross"]),
        ADMIN,
    )

    upload(db, statement([incoming(ids["gross"], f"{ids['number']} vielen Dank")]))

    tx = db.one("select status, payment_created from crm.bank_transactions")
    assert (tx["status"], tx["payment_created"]) == ("paid", False)
    assert db.value("select count(*) from crm.payments") == 1
    income = db.value("select income from crm.profit_by_month(current_date, current_date)")
    assert income == ids["gross"]


def test_f20_a_suggestion_rejected_by_a_manual_payment_frees_the_transaction(
    db: Database,
) -> None:
    ids = _invoice(db)
    upload(db, statement([incoming(100, ids["number"])]))
    payment: str = db.value(
        "select (crm.record_payment(%s, %s, current_date, 'cash', 'bar')).id",
        (ids["invoice"], ids["gross"]),
        ADMIN,
    )
    tx: str = db.value("select id from crm.bank_transactions")

    assert payment is not None
    assert db.value("select status from crm.bank_transactions") == "open"
    db.run("select crm.classify_incoming(%s, 'private')", (tx,), ADMIN)
    assert db.value("select crm.unclear_incoming()") == 0


def test_f21_version_08_amounts_directly_below_the_transaction_split_the_entry(
    db: Database,
) -> None:
    db.run("update crm.settings set iban = %s", (IBAN,))
    batch = Entry(
        Decimal("30.00"),
        "DBIT",
        txs=[
            Tx("Telekom", "", "Telefon", Decimal("20.00"), direct=True),
            Tx("Post", "", "Briefmarken", Decimal("10.00"), direct=True),
        ],
    )

    upload(db, statement([batch], version=V08))

    assert db.rows("select counterparty, amount from crm.expenses order by amount desc") == [
        {"counterparty": "Telekom", "amount": Decimal("20.00")},
        {"counterparty": "Post", "amount": Decimal("10.00")},
    ]


def test_f22_a_reversal_waits_for_daniel_and_can_become_an_expense(db: Database) -> None:
    db.run("update crm.settings set iban = %s", (IBAN,))

    result = upload(
        db, statement([outgoing(40, "Versicherung AG", "Rücklastschrift", reversal=True)])
    )
    tx: str = db.value("select id from crm.bank_transactions")
    notice: str = db.value("select title from cockpit.messages where kind = 'zahlung'")
    db.run("select crm.classify_outgoing(%s, 'expense')", (tx,), ADMIN)

    assert (result["reversals"], result["expenses"]) == (1, 0)
    assert notice == "Rückbuchung ohne passende Buchung: 40,00 €"
    assert db.value("select count(*) from crm.expenses") == 1
    assert db.value("select status from crm.bank_transactions") == "expense"


def test_f23_entries_without_status_are_skipped(db: Database) -> None:
    db.run("update crm.settings set iban = %s", (IBAN,))

    result = upload(db, statement([outgoing(5, "A", "ohne Status", status=None)]))

    assert (result["skipped"], result["new"]) == (1, 0)


def test_f24_the_same_transaction_with_other_spacing_is_stored_once(db: Database) -> None:
    db.run("update crm.settings set iban = %s", (IBAN,))

    upload(db, statement([outgoing(5, "Hetzner  Online GmbH", "Server   Oktober")]))
    again = upload(db, statement([outgoing(5, "Hetzner Online GmbH", "Server Oktober")]))

    assert again["new"] == 0


def test_f25_an_assignment_can_be_taken_back(db: Database) -> None:
    ids = _invoice(db)
    upload(db, statement([incoming(ids["gross"], ids["number"])]))
    tx: str = db.value("select id from crm.bank_transactions")

    db.run("select crm.release_transaction(%s)", (tx,), ADMIN)

    assert _invoice_status(db, ids["invoice"]) == ("open", Decimal("0.00"))
    assert db.value("select count(*) from crm.payments") == 0
    assert db.value("select status from crm.bank_transactions") == "open"


def test_f26_no_reminder_by_itself_before_the_statements_cover_the_due_date(
    db: Database,
) -> None:
    ids = _invoice(db)
    upload(db, statement([outgoing(5, "Bank", "Kontoführung")], until=TODAY - timedelta(days=1)))
    db.run(
        "set session_replication_role = replica; "
        "update crm.invoices set due_date = current_date - 2; "
        "set session_replication_role = origin"
    )

    _routine(db)

    assert db.value("select count(*) from crm.approvals where kind = 'dunning'") == 1
    assert db.value("select count(*) from crm.outbox where kind = 'dunning'") == 0
    assert ids["invoice"] is not None


def test_f27_unclear_payments_hold_the_reminders_with_one_notice(db: Database) -> None:
    _invoice(db)
    upload(db, statement([incoming(1, "unbekannt", name="Jemand")]))
    _overdue(db, 20)

    _routine(db)
    _routine(db)

    assert db.value("select count(*) from crm.approvals where kind = 'dunning'") == 1
    assert (
        db.value("select count(*) from cockpit.messages where title = 'Mahnungen warten auf dich'")
        == 1
    )


def test_f28_private_and_tax_accounts_carry_no_vat_and_services_are_not_learnt(
    db: Database,
) -> None:
    db.run("update crm.settings set iban = %s", (IBAN,))
    upload(
        db,
        statement(
            [
                outgoing(100, "Finanzamt Münster", "USt-Vorauszahlung"),
                outgoing(30, "PayPal Europe S.a.r.l.", "Kauf 1"),
                outgoing(12, "PayPal Europe S.a.r.l.", "Kauf 2"),
            ]
        ),
    )
    tax: str = db.value("select id from crm.expenses where amount = 100")
    first: str = db.value("select id from crm.expenses where amount = 30")

    db.run("select crm.set_expense_account(%s, '1780', 19)", (tax,), ADMIN)
    db.run("select crm.set_expense_account(%s, '4930', 19)", (first,), ADMIN)

    assert db.value("select vat_rate from crm.expenses where id = %s", (tax,)) == 0
    assert db.value("select account from crm.expenses where amount = 12") is None
    assert db.value("select count(*) from crm.account_rules") == 1


def test_f29_changes_of_account_and_rate_are_kept(db: Database) -> None:
    expense: str = db.value(
        "select (crm.add_cash_expense(current_date, 10, 'Kiosk', 'Papier', '4930', 19)).id",
        caller=ADMIN,
    )
    db.run("select crm.set_expense_account(%s, '4980', 7)", (expense,), ADMIN)

    changes = db.rows(
        "select old_account, new_account, old_vat_rate, new_vat_rate from crm.expense_changes "
        "order by changed_at, new_account"
    )
    assert {
        "old_account": "4930",
        "new_account": "4980",
        "old_vat_rate": Decimal("19.00"),
        "new_vat_rate": Decimal("7.00"),
    } in changes
    with pytest.raises(psycopg.errors.RaiseException, match="Verlauf"):
        db.run("delete from crm.expense_changes", caller=ADMIN)
