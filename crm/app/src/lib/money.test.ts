import { describe, expect, it } from "vitest";
import { documentTotals, parseAmount, roundCents } from "./money";

describe("documentTotals", () => {
  it("rounds VAT per rate like the database", () => {
    const totals = documentTotals([
      { quantity: 1, unit_price_net: 1500, vat_rate: 19 },
      { quantity: 3, unit_price_net: 80, vat_rate: 19 },
    ], false);
    expect(totals).toMatchObject({ net: 1740, vat: 330.6, gross: 2070.6 });
  });

  it("keeps rates apart", () => {
    const totals = documentTotals([
      { quantity: 1, unit_price_net: 10.05, vat_rate: 7 },
      { quantity: 2, unit_price_net: 0.335, vat_rate: 19 },
    ], false);
    expect(totals.groups.map((group) => group.rate)).toEqual([19, 7]);
    expect(totals.vat).toBe(0.83);
  });

  it("charges no VAT for a small business", () => {
    expect(documentTotals([{ quantity: 2, unit_price_net: 100, vat_rate: 19 }], true)).toMatchObject({ net: 200, vat: 0, gross: 200 });
  });

  it("handles negative quantities of a cancellation", () => {
    expect(documentTotals([{ quantity: -1, unit_price_net: 100, vat_rate: 19 }], false)).toMatchObject({ net: -100, vat: -19, gross: -119 });
  });
});

describe("parseAmount", () => {
  it("reads German and plain notation", () => {
    expect(parseAmount("1.234,50 €")).toBe(1234.5);
    expect(parseAmount("1234.5")).toBe(1234.5);
    expect(parseAmount("80")).toBe(80);
  });

  it("refuses text", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("zwölf")).toBeNull();
  });
});

describe("roundCents", () => {
  it("rounds half away from zero like PostgreSQL", () => {
    expect(roundCents(1.995)).toBe(2);
    expect(roundCents(-1.995)).toBe(-2);
    expect(roundCents(-0.005)).toBe(-0.01);
    expect(roundCents(2.004)).toBe(2);
  });

  it("gives a cancellation of 10.50 net at 19 % a VAT of -2.00", () => {
    expect(documentTotals([{ quantity: -1, unit_price_net: 10.5, vat_rate: 19 }], false)).toMatchObject({ net: -10.5, vat: -2, gross: -12.5 });
  });
});
