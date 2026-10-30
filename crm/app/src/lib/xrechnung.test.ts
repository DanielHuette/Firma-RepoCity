import { describe, expect, it } from "vitest";
import { INVOICE, ITEMS, SELLER } from "./fixtures";
import { XRechnungError, buildXRechnung, unitCode } from "./xrechnung";

describe("buildXRechnung", () => {
  it("writes totals, parties and escaped text", () => {
    const xml = buildXRechnung(INVOICE, ITEMS);
    expect(xml).toContain("<ram:ID>RE-2026-0001</ram:ID><ram:TypeCode>380</ram:TypeCode>");
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">330.60</ram:TaxTotalAmount><ram:GrandTotalAmount>2070.60</ram:GrandTotalAmount>');
    expect(xml).toContain("Webseite Basis &amp; Pflege");
    expect(xml).toContain("Fünf Seiten &lt;inkl.&gt; Texte");
    expect(xml).toContain('<ram:BilledQuantity unitCode="HUR">3</ram:BilledQuantity>');
    expect(xml).toContain("<ram:IBANID>DE02120300000000202051</ram:IBANID>");
    expect(xml).toContain('<ram:ID schemeID="FC">337/5000/0000</ram:ID>');
  });

  it("marks a small business as exempt", () => {
    const xml = buildXRechnung({ ...INVOICE, vat: 0, gross: 1740, seller_snapshot: { ...SELLER, small_business: true } }, ITEMS);
    expect(xml).toContain("<ram:CategoryCode>E</ram:CategoryCode>");
    expect(xml).toContain("§ 19 UStG");
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">0.00</ram:TaxTotalAmount>');
  });

  it("turns a cancellation into a credit note with positive amounts", () => {
    const negative = ITEMS.map((item) => ({ ...item, quantity: -item.quantity }));
    const xml = buildXRechnung({ ...INVOICE, number: "RE-2026-0002", net: -1740, vat: -330.6, gross: -2070.6 }, negative);
    expect(xml).toContain("<ram:TypeCode>381</ram:TypeCode>");
    expect(xml).toContain("<ram:GrandTotalAmount>2070.60</ram:GrandTotalAmount>");
  });

  it("refuses drafts", () => {
    expect(() => buildXRechnung({ ...INVOICE, status: "draft" }, ITEMS)).toThrow(XRechnungError);
  });

  it("maps units to UN/ECE codes", () => {
    expect(unitCode("Monat")).toBe("MON");
    expect(unitCode("irgendwas")).toBe("C62");
  });
});
