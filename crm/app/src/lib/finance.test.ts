import { describe, expect, it } from "vitest";
import type { Expense, ExpenseAccount, NettedReversal, ProfitMonth } from "../api/types";
import { QueryError } from "./errors";
import {
  alreadyStored, countedExpenses, decodeStatement, isTransient, reversalsCsv, expenseReference, expenseRows, expensesCsv, expensesWithoutAccount, monthRows, receiptFileName,
  receiptPath, receiptProblem, yearBefore, yearToDate,
} from "./finance";

const ID = "3f2b8c1e-0000-4000-8000-000000000001";

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: ID, transaction_id: "t1", method: "bank", spent_on: "2026-10-14", amount: 23.8, counterparty: "Hetzner Online GmbH",
    purpose: "Server Oktober", account: "4806", vat_rate: 19, created_at: "2026-10-14T10:00:00Z", reversed_by: null, ...overrides,
  };
}

const ACCOUNTS: ExpenseAccount[] = [{ number: "4806", name: "Wartungskosten für Hard- und Software", kind: "expense", position: 20 }];

describe("expenseRows", () => {
  it("books the account in debit against the bank with the input VAT key under normal taxation", () => {
    expect(expenseRows([expense()], false)).toEqual([[
      "23,80", "S", "EUR", "", "", "", "4806", "1200", "9", "1410", "A20261014-3f2b8c1e", "", "", "Hetzner Online GmbH Server Oktober",
    ]]);
  });

  it("uses key 8 for 7 %, none for 0 % and none at all for a small business", () => {
    expect(expenseRows([expense({ vat_rate: 7 })], false)[0]?.[8]).toBe("8");
    expect(expenseRows([expense({ vat_rate: 0 })], false)[0]?.[8]).toBe("");
    expect(expenseRows([expense()], true)[0]?.[8]).toBe("");
  });

  it("books cash against the cash account and leaves expenses without account out", () => {
    const rows = expenseRows([expense({ method: "cash", transaction_id: null }), expense({ account: null })], true);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[7]).toBe("1000");
    expect(expensesWithoutAccount([expense({ account: null })])).toEqual(["2026-10-14 Hetzner Online GmbH 23,80 €"]);
  });

  it("cuts the posting text at 60 characters", () => {
    expect(expenseRows([expense({ purpose: "x".repeat(80) })], true)[0]?.[13]).toHaveLength(60);
  });
});

describe("expensesCsv", () => {
  it("lists every expense with account name, rate, way and receipts", () => {
    const csv = expensesCsv([expense({ receipts: [{ id: "r", expense_id: ID, path: "p", file_name: "rechnung.pdf", content_type: "application/pdf", size_bytes: 1, uploaded_at: "" }] }), expense({ account: null })], ACCOUNTS);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[1]).toBe("14.10.2026;23,80;Hetzner Online GmbH;Server Oktober;4806;Wartungskosten für Hard- und Software;19 %;Bank;A20261014-3f2b8c1e;A20261014-3f2b8c1e_rechnung.pdf");
    expect(lines[2]).toBe("14.10.2026;23,80;Hetzner Online GmbH;Server Oktober;;ohne Konto;19 %;Bank;A20261014-3f2b8c1e;");
  });
});

describe("receipts", () => {
  it("accepts PDF and photos up to 15 MB", () => {
    expect(receiptProblem({ type: "application/pdf", size: 100 })).toBeNull();
    expect(receiptProblem({ type: "image/heic", size: 15 * 1024 * 1024 })).toBeNull();
    expect(receiptProblem({ type: "text/plain", size: 100 })).toMatch(/PDF/);
    expect(receiptProblem({ type: "image/png", size: 15 * 1024 * 1024 + 1 })).toMatch(/15 MB/);
    expect(receiptProblem({ type: "image/png", size: 0 })).toMatch(/leer/);
  });

  it("places a receipt where the database accepts it and names it for the package", () => {
    expect(receiptPath(ID, "Rechnung Oktober (1).pdf", "abc")).toBe(`belege/${ID}/abc-Rechnung_Oktober_1_.pdf`);
    expect(receiptFileName(expense(), "rechnung.pdf")).toBe("A20261014-3f2b8c1e_rechnung.pdf");
    expect(expenseReference(expense())).toHaveLength(18);
  });
});

describe("profit", () => {
  const months: ProfitMonth[] = [
    { month: "2025-12-01", income: 100, expenses: 40, unassigned: 0, profit: 60 },
    { month: "2026-01-01", income: 200, expenses: 50, unassigned: 10, profit: 150 },
    { month: "2026-02-01", income: 0, expenses: 30.1, unassigned: 0, profit: -30.1 },
  ];

  it("compares each month with the one before", () => {
    expect(monthRows(months).map((row) => row.change)).toEqual([null, 90, -180.1]);
  });

  it("adds up the year of the last month only", () => {
    expect(yearToDate(months)).toEqual({ year: 2026, income: 200, expenses: 80.1, profit: 119.9 });
    expect(yearToDate([])).toBeNull();
  });

  it("starts a year back so twelve months are shown", () => {
    expect(yearBefore("2026-10-29")).toBe("2025-11-01");
    expect(yearBefore("2026-12-05")).toBe("2026-01-01");
  });
});

describe("decodeStatement", () => {
  it("reads UTF-8 by default and the encoding the declaration names", () => {
    expect(decodeStatement(new TextEncoder().encode("<Document>Bäckerei</Document>"))).toBe("<Document>Bäckerei</Document>");
    const latin = Uint8Array.from([...new TextEncoder().encode('<?xml version="1.0" encoding="ISO-8859-1"?><a>'), 0xe4, ...new TextEncoder().encode("</a>")]);
    expect(decodeStatement(latin)).toBe('<?xml version="1.0" encoding="ISO-8859-1"?><a>ä</a>');
  });

  it("refuses bytes that do not fit the declared encoding", () => {
    expect(() => decodeStatement(Uint8Array.from([0x3c, 0x61, 0x3e, 0xe4, 0x3c]))).toThrow(/utf-8/);
  });
});

describe("countedExpenses", () => {
  it("leaves out what the bank took back", () => {
    expect(countedExpenses([expense(), expense({ id: "b", reversed_by: "t9" })]).map((item) => item.id)).toEqual([ID]);
  });
});

describe("alreadyStored", () => {
  it("knows the answer of the store when a retried upload finds its own file", () => {
    expect(alreadyStored({ status: 409 })).toBe(true);
    expect(alreadyStored({ code: "ResourceAlreadyExists" })).toBe(true);
    expect(alreadyStored({ statusCode: "409" })).toBe(true);
    expect(alreadyStored({ status: 500 })).toBe(false);
    expect(alreadyStored({})).toBe(false);
  });
});

describe("isTransient", () => {
  it("tries again after a lost connection or a busy server, never after a refusal", () => {
    expect(isTransient(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransient(new QueryError("Beleg speichern", "TypeError: Failed to fetch", ""))).toBe(true);
    expect(isTransient(new QueryError("Beleg hochladen", "Bad Gateway", "502"))).toBe(true);
    expect(isTransient(new QueryError("Beleg hochladen", "Too Many Requests", "429"))).toBe(true);
    expect(isTransient(new QueryError("Beleg speichern", "Datenbank nicht erreichbar", "PGRST001"))).toBe(true);
    expect(isTransient(new QueryError("Beleg speichern", "Der Beleg liegt nicht bei dieser Ausgabe.", "P0001"))).toBe(false);
    expect(isTransient(new QueryError("Beleg hochladen", "Forbidden", "403"))).toBe(false);
  });
});

describe("reversalsCsv", () => {
  const rows: NettedReversal[] = [
    { booked_on: "2026-10-20", amount: 119, counterparty: "Bäckerei Korn", original_on: "2026-09-30", original_direction: "in", purpose: "Rechnung RE-2026-0007", invoice_number: "RE-2026-0007" },
    { booked_on: "2026-10-21", amount: 30, counterparty: "Hetzner Online GmbH", original_on: "2026-10-02", original_direction: "out", purpose: "Server", invoice_number: null },
  ];

  it("tells the tax adviser which earlier booking no longer counts", () => {
    const lines = reversalsCsv(rows).slice(1).split("\r\n");
    expect(lines[0]).toBe("Rückbuchung am;Betrag;Gegenüber;Ursprüngliche Buchung vom;Verwendungszweck;Rechnung;Wirkung");
    expect(lines[1]).toBe("20.10.2026;119,00;Bäckerei Korn;30.09.2026;Rechnung RE-2026-0007;RE-2026-0007;Einnahme vom 30.09.2026 zählt nicht mehr");
    expect(lines[2]).toBe("21.10.2026;30,00;Hetzner Online GmbH;02.10.2026;Server;;Ausgabe vom 02.10.2026 zählt nicht mehr");
  });
});
