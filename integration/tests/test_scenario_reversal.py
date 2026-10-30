"""Scenarios F30-F47: reversals netted after a tap in the Cockpit, and receipts that are never lost.

Context: A reversal on the bank statement (RvslInd, a return code RRTN or PRDD, or return details
RtrInf) takes back an earlier booking. The CRM looks for that booking and asks in the Cockpit; after
"Verrechnen" both bookings stop counting, as Lexware Office books them (both on "Durchlaufende
Posten"), and a paid invoice is open again. A receipt file whose entry was not saved is added by the
hourly check, or reported on the lock screen (migration crm/008_rueckbuchung_belege.sql). | Input:
statements built with the helpers of test_scenario_finance, files in the bucket crm-receipts. |
Output: Assertions on bank transactions, payments, invoices, expenses, receipts, approvals, profit
and Cockpit notices.
"""

from decimal import Decimal
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from actors import tap
from test_scenario_finance import (
    IBAN,
    OTHER_IBAN,
    TODAY,
    Entry,
    Tx,
    _invoice,
    _invoice_status,
    outgoing,
    statement,
    upload,
)

from repocity_integration.database import ADMIN, READER, SERVICE, Database

VENDOR_IBAN = "DE75512108001245126199"


def _paid_by_transfer(db: Database, ids: dict[str, Any], e2e: str) -> None:
    upload(
        db,
        statement(
            [
                Entry(
                    ids["gross"],
                    "CRDT",
                    reference="P1",
                    txs=[Tx("Bäckerei Korn", OTHER_IBAN, f"Rechnung {ids['number']}", e2e=e2e)],
                )
            ]
        ),
    )


def _customer_reversal(amount: Decimal, e2e: str) -> Entry:
    # The bank takes the customer's money back; the parties stay as in the original transfer.
    return Entry(
        amount,
        "DBIT",
        reversal=True,
        reference="R1",
        txs=[Tx("Bäckerei Korn", OTHER_IBAN, "Rückbuchung", e2e=e2e, returned=True, side="Dbtr")],
    )


def _server_bill(db: Database) -> str:
    db.run("update crm.settings set iban = %s", (IBAN,))
    upload(
        db,
        statement(
            [
                Entry(
                    Decimal("30.00"),
                    "DBIT",
                    reference="E1",
                    txs=[Tx("Hetzner Online GmbH", VENDOR_IBAN, "Server Oktober", e2e="E2E-H")],
                )
            ]
        ),
    )
    expense: str = db.value("select id from crm.expenses")
    db.run("select crm.set_expense_account(%s, '4806', 19)", (expense,), ADMIN)
    return expense


def _returned_transfer() -> str:
    # A credit transfer of ours comes back: no RvslInd, only the return code and return details.
    return statement(
        [
            Entry(
                Decimal("30.00"),
                "CRDT",
                reference="R2",
                family="RRTN",
                txs=[
                    Tx(
                        "Hetzner Online GmbH",
                        VENDOR_IBAN,
                        "Rueckueberweisung",
                        e2e="E2E-H",
                        returned=True,
                        side="Cdtr",
                    )
                ],
            )
        ]
    )


def _reversal_id(db: Database) -> str:
    reversal: str = db.value("select id from crm.bank_transactions where reversal")
    return reversal


def _month(db: Database) -> dict[str, Decimal]:
    month: dict[str, Decimal] = db.one(
        "select income, expenses, profit from crm.profit_by_month(%s, %s)", (TODAY, TODAY)
    )
    return month


def test_f30_a_customer_payment_taken_back_waits_for_a_tap_and_reopens_the_invoice(
    db: Database,
) -> None:
    ids = _invoice(db)
    _paid_by_transfer(db, ids, "E2E-7")

    result = upload(db, statement([_customer_reversal(ids["gross"], "E2E-7")]))
    approval = db.one("select title, status from crm.approvals where kind = 'reversal'")
    buttons = db.value("select actions from cockpit.messages where kind = 'freigabe'")
    assert result["reversals"] == 1
    assert approval == {
        "title": f"Rückbuchung {db.value('select crm.euro(%s)', (ids['gross'],))} verrechnen?",
        "status": "pending",
    }
    assert [button["title"] for button in buttons] == ["Verrechnen", "Nicht verrechnen"]
    assert _invoice_status(db, ids["invoice"]) == ("paid", ids["gross"])

    answer = tap(db, "freigabe", "approve")

    assert answer == {"ok": True, "text": "Freigabe erteilt."}
    assert _invoice_status(db, ids["invoice"]) == ("open", Decimal("0.00"))
    assert db.value("select count(*) from crm.payments") == 0
    original: str = db.value("select id from crm.bank_transactions where not reversal")
    assert db.rows(
        "select status, reverses_transaction_id from crm.bank_transactions order by reversal"
    ) == [
        {"status": "reversed", "reverses_transaction_id": None},
        {"status": "reversed", "reverses_transaction_id": original},
    ]
    assert _month(db)["income"] == Decimal("0")
    notice = db.one(
        "select title, body from cockpit.messages where kind = 'zahlung' "
        "order by created_at desc limit 1"
    )
    assert notice["title"].startswith("Rückbuchung verrechnet: ")
    assert f"Rechnung {ids['number']} ist wieder offen" in notice["body"]


def test_f31_a_later_payment_settles_the_reopened_invoice(db: Database) -> None:
    ids = _invoice(db)
    _paid_by_transfer(db, ids, "E2E-7")
    upload(db, statement([_customer_reversal(ids["gross"], "E2E-7")]))
    tap(db, "freigabe", "approve")

    upload(
        db,
        statement(
            [
                Entry(
                    ids["gross"],
                    "CRDT",
                    reference="P2",
                    txs=[Tx("Bäckerei Korn", OTHER_IBAN, f"Rechnung {ids['number']}", e2e="E2E-8")],
                )
            ]
        ),
    )

    assert _invoice_status(db, ids["invoice"]) == ("paid", ids["gross"])
    assert _month(db)["income"] == ids["gross"]


def test_f32_a_returned_transfer_of_ours_takes_the_expense_out_of_the_profit(
    db: Database,
) -> None:
    expense = _server_bill(db)

    result = upload(db, _returned_transfer())
    tap(db, "freigabe", "approve")

    assert result["reversals"] == 1
    assert db.value("select reversed_by from crm.expenses where id = %s", (expense,)) == (
        _reversal_id(db)
    )
    assert _month(db) == {
        "income": Decimal("0"),
        "expenses": Decimal("0"),
        "profit": Decimal("0"),
    }
    assert db.value("select crm.unclear_incoming()") == 0
    assert (
        db.value(
            "select body from cockpit.messages where kind = 'zahlung' "
            "order by created_at desc limit 1"
        )
        == f"Hetzner Online GmbH, 30,00 € vom {TODAY:%d.%m.%Y}: zählt nicht mehr als Ausgabe."
    )


def test_f33_not_netting_keeps_both_bookings_as_they_are(db: Database) -> None:
    expense = _server_bill(db)
    upload(db, _returned_transfer())

    answer = tap(db, "freigabe", "reject")

    assert answer == {"ok": True, "text": "Freigabe abgelehnt."}
    assert db.rows("select status from crm.bank_transactions order by reversal") == [
        {"status": "expense"},
        {"status": "open"},
    ]
    assert db.value("select reversed_by from crm.expenses where id = %s", (expense,)) is None
    assert _month(db)["expenses"] == Decimal("30.00")


def test_f34_without_one_clear_booking_daniel_picks_it_on_the_page(db: Database) -> None:
    db.run("update crm.settings set iban = %s", (IBAN,))
    upload(
        db,
        statement(
            [
                outgoing(50, "Versicherung AG", "Beitrag Oktober", reference="V1"),
                outgoing(50, "Versicherung AG", "Beitrag November", reference="V2"),
            ]
        ),
    )

    upload(
        db,
        statement(
            [
                Entry(
                    Decimal("50.00"),
                    "CRDT",
                    reversal=True,
                    reference="V3",
                    txs=[Tx("Versicherung AG", "", "Rückbuchung")],
                )
            ]
        ),
    )
    reversal = _reversal_id(db)
    candidates = db.rows(
        "select id, purpose from crm.reversal_candidates(%s) order by purpose", (reversal,), ADMIN
    )
    db.run("select crm.net_reversal(%s, %s)", (reversal, candidates[1]["id"]), ADMIN)

    assert db.value("select count(*) from crm.approvals where kind = 'reversal'") == 0
    assert (
        db.value(
            "select title from cockpit.messages where kind = 'zahlung' and title like '%%ohne%%'"
        )
        == "Rückbuchung ohne passende Buchung: 50,00 €"
    )
    assert [row["purpose"] for row in candidates] == ["Beitrag November", "Beitrag Oktober"]
    assert db.rows(
        "select purpose, reversed_by is not null as reversed from crm.expenses order by purpose"
    ) == [
        {"purpose": "Beitrag November", "reversed": False},
        {"purpose": "Beitrag Oktober", "reversed": True},
    ]


def test_f35_netting_checks_amount_direction_and_doing_it_twice(db: Database) -> None:
    _server_bill(db)
    upload(db, statement([outgoing(40, "Bürohaus", "Papier", reference="E9")]))
    upload(db, _returned_transfer())
    reversal = _reversal_id(db)
    paper: str = db.value("select id from crm.bank_transactions where amount = 40")
    server: str = db.value(
        "select id from crm.bank_transactions where amount = 30 and not reversal"
    )

    with pytest.raises(psycopg.errors.RaiseException, match="passt nicht"):
        db.run("select crm.net_reversal(%s, %s)", (reversal, paper), ADMIN)
    with pytest.raises(psycopg.errors.RaiseException, match="passt nicht"):
        db.run("select crm.net_reversal(%s, %s)", (reversal, reversal), ADMIN)
    with pytest.raises(psycopg.errors.RaiseException, match="Administrator"):
        db.run("select crm.net_reversal(%s, %s)", (reversal, server), READER)
    db.run("select crm.net_reversal(%s, %s)", (reversal, server), ADMIN)
    with pytest.raises(psycopg.errors.RaiseException, match="bereits verrechnet"):
        db.run("select crm.net_reversal(%s, %s)", (reversal, server), ADMIN)

    assert db.value("select status from crm.approvals where kind = 'reversal'") == "rejected"


def test_f36_a_suggestion_taken_back_leaves_no_waiting_approval(db: Database) -> None:
    ids = _invoice(db)
    upload(
        db,
        statement(
            [
                Entry(
                    Decimal("100.00"),
                    "CRDT",
                    reference="P5",
                    txs=[Tx("Bäckerei Korn", OTHER_IBAN, f"{ids['number']} Teil", e2e="E2E-S")],
                )
            ]
        ),
    )
    upload(db, statement([_customer_reversal(Decimal("100.00"), "E2E-S")]))

    tap(db, "freigabe", "approve")

    assert db.rows("select kind, status from crm.approvals order by kind") == [
        {"kind": "payment", "status": "rejected"},
        {"kind": "reversal", "status": "approved"},
    ]
    assert _invoice_status(db, ids["invoice"]) == ("open", Decimal("0.00"))
    assert db.value("select count(distinct status) from crm.bank_transactions") == 1


def _cash_expense(db: Database) -> str:
    expense: str = db.value(
        "select (crm.add_cash_expense(current_date, 23.80, 'Bürohaus', 'Papier', '4930', 19)).id",
        caller=ADMIN,
    )
    return expense


def _stored_file(db: Database, name: str, mimetype: str, minutes_ago: int) -> None:
    db.run(
        "insert into storage.objects (bucket_id, name, metadata, created_at) values "
        "('crm-receipts', %s, jsonb_build_object('mimetype', %s::text, 'size', 2048), "
        "now() - make_interval(mins => %s))",
        (name, mimetype, minutes_ago),
    )


def test_f37_saving_the_same_receipt_twice_keeps_one(db: Database) -> None:
    expense = _cash_expense(db)
    path = f"belege/{expense}/{uuid4()}-quittung.pdf"
    query = "select (crm.add_receipt(%s, %s, 'quittung.pdf', 'application/pdf', 1200)).id"

    first = db.value(query, (expense, path), ADMIN)
    second = db.value(query, (expense, path), ADMIN)

    assert first == second
    assert db.value("select count(*) from crm.receipts") == 1


def test_f38_a_file_without_entry_is_added_by_the_hourly_check(db: Database) -> None:
    expense = _cash_expense(db)
    _stored_file(db, f"belege/{expense}/{uuid4()}-Rechnung_Oktober.pdf", "application/pdf", 20)
    _stored_file(db, f"belege/{expense}/{uuid4()}-gerade_hochgeladen.png", "image/png", 1)

    added = db.value("select crm.check_receipts()", caller=SERVICE)
    again = db.value("select crm.check_receipts()", caller=SERVICE)

    assert (added, again) == (1, 0)
    assert db.one("select file_name, content_type, size_bytes from crm.receipts") == {
        "file_name": "Rechnung_Oktober.pdf",
        "content_type": "application/pdf",
        "size_bytes": 2048,
    }
    assert db.value("select count(*) from cockpit.messages where kind = 'beleg'") == 0


def test_f39_a_file_that_cannot_be_added_is_reported_once(db: Database) -> None:
    expense = _cash_expense(db)
    _stored_file(db, f"belege/{uuid4()}/{uuid4()}-fremd.pdf", "application/pdf", 30)
    _stored_file(db, f"belege/{expense}/{uuid4()}-notiz.txt", "text/plain", 30)

    db.run("select crm.check_receipts()", caller=SERVICE)
    db.run("select crm.check_receipts()", caller=SERVICE)

    assert db.rows(
        "select title, priority, link from cockpit.messages where kind = 'beleg' order by title"
    ) == [
        {
            "title": "Beleg nicht gespeichert: fremd.pdf",
            "priority": "wichtig",
            "link": "https://crm.speedofthespirit.dev/finanzen?tab=ausgaben",
        },
        {
            "title": "Beleg nicht gespeichert: notiz.txt",
            "priority": "wichtig",
            "link": "https://crm.speedofthespirit.dev/finanzen?tab=ausgaben",
        },
    ]
    assert db.value("select count(*) from crm.receipts") == 0


def test_f40_the_receipt_check_runs_every_hour(db: Database) -> None:
    job = db.one("select schedule, command from cron.job where jobname = 'crm-receipts'")

    assert job["schedule"] == "41 * * * *"
    assert "crm.check_receipts()" in job["command"]


def test_f41_a_booking_naming_only_this_account_gets_no_counterparty(db: Database) -> None:
    db.run("update crm.settings set iban = %s", (IBAN,))

    upload(
        db,
        statement(
            [
                Entry(
                    Decimal("20.00"),
                    "DBIT",
                    reference="G1",
                    txs=[Tx("Daniel Hütte Firma", IBAN, "Bargeld", side="Dbtr")],
                )
            ]
        ),
    )

    assert db.one("select counterparty, counterparty_iban from crm.bank_transactions") == {
        "counterparty": "",
        "counterparty_iban": "",
    }


def test_f42_filing_the_reversal_on_the_page_settles_its_approval(db: Database) -> None:
    _server_bill(db)
    upload(db, _returned_transfer())

    db.run("select crm.classify_incoming(%s, 'other_income')", (_reversal_id(db),), ADMIN)

    assert db.value("select status from crm.approvals where kind = 'reversal'") == "rejected"


def test_f43_a_payment_by_hand_does_not_sweep_the_reversal_approval(db: Database) -> None:
    ids = _invoice(db)
    upload(
        db,
        statement(
            [
                Entry(
                    Decimal("100.00"),
                    "CRDT",
                    reference="P7",
                    txs=[Tx("Bäckerei Korn", OTHER_IBAN, f"{ids['number']} Teil", e2e="E2E-T")],
                )
            ]
        ),
    )
    tap(db, "freigabe", "approve")
    upload(db, statement([_customer_reversal(Decimal("100.00"), "E2E-T")]))
    db.run(
        "select crm.record_payment(%s, %s, current_date, 'cash', 'bar')",
        (ids["invoice"], ids["gross"] - 100),
        ADMIN,
    )

    assert db.value("select status from crm.approvals where kind = 'reversal'") == "pending"
    tap(db, "freigabe", "approve")
    assert _invoice_status(db, ids["invoice"]) == ("open", ids["gross"] - 100)


def test_f44_a_payment_entered_by_hand_is_removed_but_stays_in_the_file(db: Database) -> None:
    ids = _invoice(db)
    db.run(
        "select crm.record_payment(%s, %s, current_date, 'transfer', 'Überweisung laut Anruf')",
        (ids["invoice"], ids["gross"]),
        ADMIN,
    )
    _paid_by_transfer(db, ids, "E2E-L")
    assert db.value("select payment_created from crm.bank_transactions") is False

    upload(db, statement([_customer_reversal(ids["gross"], "E2E-L")]))
    tap(db, "freigabe", "approve")

    assert db.value("select count(*) from crm.payments") == 0
    assert _invoice_status(db, ids["invoice"]) == ("open", Decimal("0.00"))
    assert (
        db.value(
            "select count(*) from crm.activities where body like %s",
            ("%Überweisung laut Anruf%zurückgebucht%",),
        )
        == 1
    )


def test_f45_an_open_reversal_does_not_hold_the_reminders(db: Database) -> None:
    _server_bill(db)
    upload(db, _returned_transfer())
    tap(db, "freigabe", "reject")

    assert db.value("select status from crm.bank_transactions where reversal") == "open"
    assert db.value("select crm.unclear_incoming()") == 0


def test_f46_asking_twice_or_for_a_normal_booking_changes_nothing(db: Database) -> None:
    _server_bill(db)
    upload(db, _returned_transfer())
    normal: str = db.value("select id from crm.bank_transactions where not reversal")

    db.run("select crm.propose_reversal(%s)", (_reversal_id(db),), ADMIN)
    with pytest.raises(psycopg.errors.RaiseException, match="keine offene Rückbuchung"):
        db.run("select crm.propose_reversal(%s)", (normal,), ADMIN)

    assert db.value("select count(*) from crm.approvals where kind = 'reversal'") == 1


@pytest.mark.parametrize(
    ("direction", "family", "proprietary"),
    [
        ("DBIT", None, "NDDT+109+9075"),
        ("CRDT", None, "NTRF+159+997"),
        ("DBIT", None, "109+NDDT+9075/625+992+SEPA-LASTSCHR"),
        ("CRDT", None, "NSTO+899+000"),
        ("DBIT", "UPDD", None),
        ("CRDT", "XRTN", None),
        ("DBIT", "PSTE", None),
    ],
)
def test_f47_returns_are_known_by_the_codes_of_german_banks(
    db: Database, direction: str, family: str | None, proprietary: str | None
) -> None:
    db.run("update crm.settings set iban = %s", (IBAN,))

    result = upload(
        db,
        statement(
            [
                Entry(
                    Decimal("12.00"),
                    direction,
                    family=family,
                    proprietary=proprietary,
                    txs=[Tx("Bäckerei Korn", OTHER_IBAN, "Rückgabe")],
                ),
                Entry(
                    Decimal("13.00"),
                    direction,
                    proprietary="NTRF+166+97261",
                    txs=[Tx("Bäckerei Korn", OTHER_IBAN, "Gutschrift")],
                ),
            ]
        ),
    )

    assert result["reversals"] == 1
    assert db.value("select amount from crm.bank_transactions where reversal") == Decimal("12.00")
