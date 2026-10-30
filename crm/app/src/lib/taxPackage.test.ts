import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { BOM } from "./csv";
import { DEFAULT_DATEV } from "./datev";
import { TAX_INVOICES, TAX_PAYMENTS } from "./fixtures";
import type { Expense, ExpenseAccount } from "../api/types";
import { ledgerEntries } from "./ledger";
import {
  assemblePackage, filenameSlug, invoicesCsv, openItemsCsv, paymentsCsv, pdfName, periodLabel, periodRange, previousMonth,
} from "./taxPackage";

const ENTRIES = ledgerEntries(TAX_INVOICES, TAX_PAYMENTS);
const YEAR = { kind: "year", year: 2026, index: 1 } as const;
const PDF = new TextEncoder().encode("%PDF-1.7");

function lines(text: string): string[] {
  expect(text.startsWith(BOM)).toBe(true);
  return text.slice(1).trimEnd().split("\r\n");
}

describe("periods", () => {
  it("covers a month, a quarter and a year", () => {
    expect(periodRange({ kind: "month", year: 2026, index: 2 })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange({ kind: "quarter", year: 2026, index: 4 })).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodRange(YEAR)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("names the period in plain German", () => {
    expect(periodLabel({ kind: "month", year: 2026, index: 10 })).toBe("Oktober 2026");
    expect(periodLabel({ kind: "quarter", year: 2026, index: 3 })).toBe("3. Quartal 2026");
    expect(periodLabel(YEAR)).toBe("2026");
  });

  it("proposes the previous month, across the turn of the year", () => {
    expect(previousMonth("2026-10-24")).toEqual({ kind: "month", year: 2026, index: 9 });
    expect(previousMonth("2027-01-05")).toEqual({ kind: "month", year: 2026, index: 12 });
  });
});

describe("file names", () => {
  it.each([
    ["Dachdeckerei Müller & Söhne", "Dachdeckerei_Mueller_Soehne"],
    ["Straßenbau Ägir", "Strassenbau_Aegir"],
    ["Café Élan", "Cafe_Elan"],
    ["RA-2026-0001", "RA-2026-0001"],
    ["***", "x"],
  ])("turns %s into %s", (name, expected) => {
    expect(filenameSlug(name)).toBe(expected);
  });

  it("names a PDF after number, date and customer", () => {
    expect(pdfName(ENTRIES[0] ?? (undefined as never))).toBe("RA-2026-0001_2026-03-01_Dachdeckerei_Muster.pdf");
  });
});

describe("lists", () => {
  it("writes the invoice journal with payments and open amounts", () => {
    const journal = lines(invoicesCsv(ENTRIES));
    expect(journal[0]).toBe("Rechnungsnummer;Datum;Leistungsdatum;Art;Kunde;Netto;USt;Brutto;Zuletzt bezahlt am;Bezahlt;Offen;Storno zu");
    expect(journal[1]).toBe("RA-2026-0001;01.03.2026;01.03.2026;Rechnung;Dachdeckerei Muster;390,00;74,10;464,10;10.03.2026;464,10;0,00;");
    expect(journal[4]?.startsWith("RA-2026-0004;02.05.2026;02.05.2026;Stornorechnung;")).toBe(true);
    expect(journal[4]?.endsWith(";RA-2026-0003")).toBe(true);
  });

  it("keeps only invoices with an open amount among the open items", () => {
    expect(lines(openItemsCsv(ENTRIES)).slice(1)).toEqual(["RA-2026-0002;01.04.2026;Dachdeckerei Muster;1190,00;500,00;690,00"]);
  });

  it("lists the payments received", () => {
    const payments = lines(paymentsCsv(TAX_PAYMENTS));
    expect(payments[0]).toBe("Eingang am;Betrag;Rechnungsnummer;Kunde;Art;Verwendungszweck");
    expect(payments[1]).toBe("10.03.2026;464,10;RA-2026-0001;Dachdeckerei Muster;Überweisung;Überweisung");
  });
});

describe("assemblePackage", () => {
  const pdfs = new Map(TAX_INVOICES.filter((invoice) => invoice.id !== "inv-2").map((invoice) => [invoice.id, PDF]));
  const result = assemblePackage({ period: YEAR, entries: ENTRIES, payments: TAX_PAYMENTS, pdfs, created: new Date(Date.UTC(2026, 0, 2)) });
  const files = unzipSync(result.zip);

  it("puts every file under one folder named after the period", () => {
    expect(result.fileName).toBe("Steuer_2026.zip");
    expect(Object.keys(files).filter((name) => !name.endsWith("/")).sort()).toEqual([
      "Steuer_2026/Rechnungen/RA-2026-0001_2026-03-01_Dachdeckerei_Muster.pdf",
      "Steuer_2026/Rechnungen/RA-2026-0003_2026-05-01_Dachdeckerei_Muster.pdf",
      "Steuer_2026/Stornorechnungen/RA-2026-0004_2026-05-02_Dachdeckerei_Muster.pdf",
      "Steuer_2026/datev-buchungsstapel.csv",
      "Steuer_2026/fehlende-pdfs.txt",
      "Steuer_2026/offene-posten.csv",
      "Steuer_2026/rechnungen.csv",
      "Steuer_2026/zahlungen.csv",
    ]);
  });

  it("names missing PDFs by number instead of failing", () => {
    expect(result.missing).toEqual(["RA-2026-0002"]);
    expect(strFromU8(files["Steuer_2026/fehlende-pdfs.txt"] ?? new Uint8Array())).toContain("RA-2026-0002");
  });

  it("adds the DATEV batch with a description of the period", () => {
    const datev = strFromU8(files["Steuer_2026/datev-buchungsstapel.csv"] ?? new Uint8Array());
    expect(datev).toContain('"Ausgangsrechnungen 2026"');
    expect(datev.split("\r\n")).toHaveLength(2 + TAX_INVOICES.length + 1);
  });

  it("books the DATEV batch per VAT rate with the adviser's numbers", () => {
    const items = new Map([["inv-1", [{ quantity: 1, unit_price_net: 300, vat_rate: 19 as const }, { quantity: 1, unit_price_net: 90, vat_rate: 7 as const }]]]);
    const datev = { ...DEFAULT_DATEV, consultantNumber: 1234567, clientNumber: 12345 };
    const split = assemblePackage({ period: YEAR, entries: ENTRIES.slice(0, 1), payments: [], pdfs, items, datev, created: new Date() });
    const text = strFromU8(unzipSync(split.zip)["Steuer_2026/datev-buchungsstapel.csv"] ?? new Uint8Array());
    expect(text).toContain(";1234567;12345;20260101;4;");
    expect(text.split("\r\n").slice(2, 4).map((row) => row.split(";")[7])).toEqual(["8400", "8300"]);
  });

  it("names invoices whose tax-free lines lack the account", () => {
    const items = new Map([["inv-1", [{ quantity: 1, unit_price_net: 390, vat_rate: 0 as const }]]]);
    const result = assemblePackage({ period: YEAR, entries: ENTRIES.slice(0, 1), payments: [], pdfs, items, created: new Date() });
    expect(result.missingTaxFreeAccount).toEqual(["RA-2026-0001"]);
  });

  it("leaves out the list of missing PDFs when every PDF is there", () => {
    const complete = new Map(TAX_INVOICES.map((invoice) => [invoice.id, PDF]));
    const full = assemblePackage({ period: YEAR, entries: ENTRIES, payments: [], pdfs: complete, created: new Date() });
    expect(full.missing).toEqual([]);
    expect(Object.keys(unzipSync(full.zip))).not.toContain("Steuer_2026/fehlende-pdfs.txt");
  });
});

describe("assemblePackage with expenses", () => {
  const id = "3f2b8c1e-0000-4000-8000-000000000001";
  const receipt = { id: "r1", expense_id: id, path: `belege/${id}/x-Rechnung Okt.PDF`, file_name: "Rechnung Okt.PDF", content_type: "application/pdf", size_bytes: 8, uploaded_at: "" };
  const booked: Expense = {
    id, transaction_id: "t1", method: "bank", spent_on: "2026-10-14", amount: 23.8, counterparty: "Hetzner Online GmbH", purpose: "Server",
    account: "4806", vat_rate: 19, created_at: "", reversed_by: null, receipts: [receipt, { ...receipt, id: "r2", path: `belege/${id}/y-Rechnung Okt.PDF` }],
  };
  const open: Expense = { ...booked, id: "9a9a9a9a-0000-4000-8000-000000000002", account: null, receipts: [] };
  const accounts: ExpenseAccount[] = [{ number: "4806", name: "Wartungskosten für Hard- und Software", kind: "expense", position: 1 }];
  const receipts = new Map([[receipt.path, PDF], [`belege/${id}/y-Rechnung Okt.PDF`, PDF]]);
  const result = assemblePackage({
    period: YEAR, entries: [], payments: [], pdfs: new Map(), created: new Date(Date.UTC(2026, 0, 2)),
    expenses: { list: [booked, open], accounts, receipts, smallBusiness: false },
  });
  const files = unzipSync(result.zip);

  it("adds the list, the own posting batch, every receipt and the note on expenses without account", () => {
    expect(Object.keys(files).filter((name) => name.includes("Belege/") || name.includes("ausgaben")).sort()).toEqual([
      "Steuer_2026/Belege/A20261014-3f2b8c1e_Rechnung_Okt.pdf",
      "Steuer_2026/Belege/A20261014-3f2b8c1e_Rechnung_Okt_2.pdf",
      "Steuer_2026/ausgaben-ohne-konto.txt",
      "Steuer_2026/ausgaben.csv",
      "Steuer_2026/datev-ausgaben.csv",
    ]);
    expect(result.expensesWithoutAccount).toEqual(["2026-10-14 Hetzner Online GmbH 23,80 €"]);
  });

  it("books only the expense with an account, in debit against the bank with key 9", () => {
    const rows = strFromU8(files["Steuer_2026/datev-ausgaben.csv"] ?? new Uint8Array()).trimEnd().split("\r\n");
    expect(rows[0]).toContain('"Ausgaben 2026"');
    expect(rows.slice(2)).toEqual(["23,80;S;EUR;;;;4806;1200;9;1410;A20261014-3f2b8c1e;;;Hetzner Online GmbH Server"]);
  });

  it("names the receipts in the list as they are stored", () => {
    const rows = strFromU8(files["Steuer_2026/ausgaben.csv"] ?? new Uint8Array()).trimEnd().split("\r\n");
    expect(rows[1]?.endsWith(";A20261014-3f2b8c1e_Rechnung_Okt.pdf, A20261014-3f2b8c1e_Rechnung_Okt.pdf")).toBe(true);
  });
});

describe("assemblePackage with a reversed expense", () => {
  const id = "5c5c5c5c-0000-4000-8000-000000000003";
  const receipt = { id: "r3", expense_id: id, path: `belege/${id}/z-Hetzner.pdf`, file_name: "Hetzner.pdf", content_type: "application/pdf", size_bytes: 8, uploaded_at: "" };
  const reversed: Expense = {
    id, transaction_id: "t2", method: "bank", spent_on: "2026-10-20", amount: 30, counterparty: "Hetzner Online GmbH", purpose: "Server",
    account: "4806", vat_rate: 19, created_at: "", reversed_by: "t9", receipts: [receipt],
  };
  const accounts: ExpenseAccount[] = [{ number: "4806", name: "Wartungskosten für Hard- und Software", kind: "expense", position: 1 }];
  const result = assemblePackage({
    period: YEAR, entries: [], payments: [], pdfs: new Map(), created: new Date(Date.UTC(2026, 0, 2)),
    expenses: { list: [reversed], accounts, receipts: new Map([[receipt.path, PDF]]), smallBusiness: false },
  });
  const files = unzipSync(result.zip);

  it("leaves an expense the bank took back out of the list, the batch and the receipts", () => {
    expect(Object.keys(files).filter((name) => name.includes("Belege/"))).toEqual([]);
    expect(strFromU8(files["Steuer_2026/datev-ausgaben.csv"] ?? new Uint8Array()).trimEnd().split("\r\n")).toHaveLength(2);
    expect(strFromU8(files["Steuer_2026/ausgaben.csv"] ?? new Uint8Array()).trimEnd().split("\r\n")).toHaveLength(1);
  });
});

describe("assemblePackage with netted reversals", () => {
  const base = { period: YEAR, entries: [], payments: [], pdfs: new Map<string, Uint8Array>(), created: new Date(Date.UTC(2026, 0, 2)) };

  it("adds the list of reversals only when there is one", () => {
    const reversal = { booked_on: "2026-10-20", amount: 30, counterparty: "Hetzner Online GmbH", original_on: "2026-10-02", original_direction: "out" as const, purpose: "Server", invoice_number: null };
    expect(Object.keys(unzipSync(assemblePackage({ ...base, reversals: [reversal] }).zip))).toContain("Steuer_2026/rueckbuchungen.csv");
    expect(Object.keys(unzipSync(assemblePackage({ ...base, reversals: [] }).zip))).not.toContain("Steuer_2026/rueckbuchungen.csv");
  });
});
