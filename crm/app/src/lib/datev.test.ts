// Ported from test_tax_export.py of the RadarAuditor: same accounts, header and columns.
import { describe, expect, it } from "vitest";
import { BOM } from "./csv";
import type { LineItem } from "../api/types";
import {
  DATEV_COLUMNS, DEFAULT_DATEV, datevFile, datevHeader, datevNumberProblem, datevRows, datevSettingsFrom, missingTaxFreeAccount, taxFreeAccountProblem,
} from "./datev";
import { SELLER, TAX_INVOICES, TAX_PAYMENTS, taxInvoice } from "./fixtures";
import { ledgerEntries } from "./ledger";

const YEAR = { from: "2026-01-01", to: "2026-12-31" };
const CREATED = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));

describe("datevHeader", () => {
  it("writes the EXTF header of a posting batch for the period", () => {
    const header = datevHeader(YEAR, DEFAULT_DATEV, "Ausgangsrechnungen 2026", CREATED);
    expect(header.startsWith('"EXTF";700;21;"Buchungsstapel";13;')).toBe(true);
    expect(header).toContain(";20260101;4;20260101;20261231;");
    expect(header).toContain('"Ausgangsrechnungen 2026"');
    expect(header).toContain(";20260102030405000;");
    expect(header.endsWith(';1;0;0;"EUR"')).toBe(true);
  });

  it("starts the fiscal year on 1 January also for a single month", () => {
    const header = datevHeader({ from: "2026-10-01", to: "2026-10-31" }, DEFAULT_DATEV, "Test", CREATED);
    expect(header).toContain(";20260101;4;20261001;20261031;");
  });

  it("carries consultant, client number and account length", () => {
    const settings = { ...DEFAULT_DATEV, consultantNumber: 1001, clientNumber: 7, accountLength: 5 };
    expect(datevHeader(YEAR, settings, "Test", CREATED)).toContain(";1001;7;20260101;5;");
  });
});

describe("datevRows", () => {
  const rows = datevRows(ledgerEntries(TAX_INVOICES, TAX_PAYMENTS), DEFAULT_DATEV);

  it("books an invoice gross on debit, debtor account against revenue", () => {
    const first = rows[0] ?? [];
    expect([first[0], first[1], first[6], first[7], first[9], first[10]]).toEqual(["464,10", "S", "1400", "8400", "0103", "RA-2026-0001"]);
    expect(first[13]).toBe("RA-2026-0001 Dachdeckerei Muster");
    expect(first).toHaveLength(DATEV_COLUMNS.length);
  });

  it("books a cancellation with its absolute amount on credit", () => {
    expect([rows[3]?.[0], rows[3]?.[1]]).toEqual(["238,00", "H"]);
  });

  it("books an invoice of a small business on the small business account", () => {
    const small = { ...taxInvoice("inv-9", "RA-2026-0009", "2026-06-01", 200), net: 200, vat: 0, seller_snapshot: { ...SELLER, small_business: true } };
    const settings = { ...DEFAULT_DATEV, debtorAccount: 10000 };
    const [row] = datevRows(ledgerEntries([small], []), settings);
    expect([row?.[6], row?.[7]]).toEqual(["10000", "8195"]);
  });

  it("cuts receipt field and booking text to the DATEV lengths", () => {
    const long = { ...taxInvoice("inv-8", "R".repeat(40), "2026-06-01", 119), customer_snapshot: { ...TAX_INVOICES[0]?.customer_snapshot, name: "N".repeat(80) } } as never;
    const [row] = datevRows(ledgerEntries([long], []), DEFAULT_DATEV);
    expect(row?.[10]).toHaveLength(36);
    expect(row?.[13]).toHaveLength(60);
  });
});

describe("datevFile", () => {
  it("writes header, column names and postings as CSV with byte order mark", () => {
    const lines = datevFile("HEADER", [["1;2"]]).split("\r\n");
    expect(lines[0]).toBe(`${BOM}HEADER`);
    expect(lines[1]?.split(";").slice(0, 2)).toEqual(["Umsatz (ohne Soll/Haben-Kz)", "Soll/Haben-Kennzeichen"]);
    expect(lines[1]?.split(";").at(-1)).toBe("Buchungstext");
    expect(lines[2]).toBe('"1;2"');
  });
});

function line(net: number, rate: 0 | 7 | 19, quantity = 1): LineItem {
  return { position: 1, product_id: null, title: "Leistung", description: "", quantity, unit: "Stück", unit_price_net: net, vat_rate: rate };
}

describe("datevRows per VAT rate", () => {
  const regular = { ...SELLER, small_business: false };

  it("books revenue at 7 % VAT on 8300", () => {
    const invoice = { ...taxInvoice("inv-7", "RE-7", "2026-06-01", 107), net: 100, vat: 7, seller_snapshot: regular };
    const [row] = datevRows(ledgerEntries([invoice], []), DEFAULT_DATEV, new Map([["inv-7", [line(100, 7)]]]));
    expect([row?.[0], row?.[1], row?.[6], row?.[7]]).toEqual(["107,00", "S", "1400", "8300"]);
  });

  it("splits an invoice with 7 % and 19 % lines into one posting per rate", () => {
    const invoice = { ...taxInvoice("inv-m", "RE-M", "2026-06-01", 345), net: 300, vat: 45, seller_snapshot: regular };
    const items = new Map([["inv-m", [line(200, 19), line(50, 7, 2)]]]);
    const rows = datevRows(ledgerEntries([invoice], []), DEFAULT_DATEV, items);
    expect(rows.map((row) => [row[0], row[1], row[7], row[10]])).toEqual([["238,00", "S", "8400", "RE-M"], ["107,00", "S", "8300", "RE-M"]]);
  });

  it("books a mixed cancellation on credit, per rate", () => {
    const invoice = { ...taxInvoice("inv-c", "RE-C", "2026-06-02", -345, "inv-m"), net: -300, vat: -45, seller_snapshot: regular };
    const items = new Map([["inv-c", [line(200, 19, -1), line(50, 7, -2)]]]);
    const rows = datevRows(ledgerEntries([invoice], []), DEFAULT_DATEV, items);
    expect(rows.map((row) => [row[0], row[1], row[7]])).toEqual([["238,00", "H", "8400"], ["107,00", "H", "8300"]]);
  });

  it("books every line of a small business on 8195 without VAT", () => {
    const invoice = { ...taxInvoice("inv-s", "RE-S", "2026-06-01", 300), net: 300, vat: 0, seller_snapshot: { ...SELLER, small_business: true } };
    const rows = datevRows(ledgerEntries([invoice], []), DEFAULT_DATEV, new Map([["inv-s", [line(200, 19), line(100, 7)]]]));
    expect(rows.map((row) => [row[0], row[7]])).toEqual([["300,00", "8195"]]);
  });
});

describe("DATEV numbers from the settings", () => {
  it("fills consultant and client number into the header", () => {
    const settings = datevSettingsFrom({ datev_consultant_number: "1234567", datev_client_number: "12345", datev_tax_free_account: "" });
    expect(datevHeader(YEAR, settings, "Test", CREATED)).toContain(";1234567;12345;20260101;4;");
  });

  it("leaves both empty when they are not set", () => {
    expect(datevSettingsFrom({ datev_consultant_number: "", datev_client_number: "", datev_tax_free_account: "" }))
      .toMatchObject({ consultantNumber: null, clientNumber: null, taxFreeAccount: null });
  });

  it("accepts only digits of the allowed length", () => {
    expect(datevNumberProblem("", 7)).toBeNull();
    expect(datevNumberProblem("1234567", 7)).toBeNull();
    expect(datevNumberProblem("12345678", 7)).not.toBeNull();
    expect(datevNumberProblem("12a", 5)).not.toBeNull();
  });
});

describe("tax-free lines and rounding", () => {
  const regular = { ...SELLER, small_business: false };

  it("books a 0 % line under normal taxation on the tax-free account from the settings", () => {
    const invoice = { ...taxInvoice("inv-0", "RE-0", "2026-06-01", 50), net: 50, vat: 0, seller_snapshot: regular };
    const settings = datevSettingsFrom({ datev_consultant_number: "", datev_client_number: "", datev_tax_free_account: "8100" });
    const [row] = datevRows(ledgerEntries([invoice], []), settings, new Map([["inv-0", [line(50, 0)]]]));
    expect([row?.[0], row?.[7]]).toEqual(["50,00", "8100"]);
  });

  it("names the invoices whose 0 % lines need the tax-free account while it is missing", () => {
    const invoice = { ...taxInvoice("inv-0", "RE-0", "2026-06-01", 169), net: 150, vat: 19, seller_snapshot: regular };
    const entries = ledgerEntries([invoice], []);
    const items = new Map([["inv-0", [line(100, 19), line(50, 0)]]]);
    expect(missingTaxFreeAccount(entries, DEFAULT_DATEV, items)).toEqual(["RE-0"]);
    expect(datevRows(entries, DEFAULT_DATEV, items).map((row) => row[7])).toEqual(["8400", ""]);
    expect(missingTaxFreeAccount(entries, { ...DEFAULT_DATEV, taxFreeAccount: 8100 }, items)).toEqual([]);
  });

  it("books a cancellation of 10.50 net at 19 % with 12.50 on credit", () => {
    const invoice = { ...taxInvoice("inv-r", "RE-R", "2026-06-02", -12.5, "inv-x"), net: -10.5, vat: -2, seller_snapshot: regular };
    const [row] = datevRows(ledgerEntries([invoice], []), DEFAULT_DATEV, new Map([["inv-r", [line(10.5, 19, -1)]]]));
    expect([row?.[0], row?.[1], row?.[7]]).toEqual(["12,50", "H", "8400"]);
  });

  it("accepts a tax-free account of exactly four digits", () => {
    expect(taxFreeAccountProblem("")).toBeNull();
    expect(taxFreeAccountProblem("8100")).toBeNull();
    expect(taxFreeAccountProblem("810")).not.toBeNull();
  });
});
