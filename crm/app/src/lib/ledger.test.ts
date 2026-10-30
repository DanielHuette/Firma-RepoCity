import { describe, expect, it } from "vitest";
import { TAX_INVOICES, TAX_PAYMENTS } from "./fixtures";
import { ledgerEntries } from "./ledger";

describe("ledgerEntries", () => {
  const entries = ledgerEntries(TAX_INVOICES, TAX_PAYMENTS);

  it("counts payments of the period and the latest payment day", () => {
    expect(entries.map((entry) => entry.paid)).toEqual([464.1, 500, 0, 0]);
    expect(entries[1]?.paidOn).toBe("2026-04-20");
    expect(entries[2]?.paidOn).toBeNull();
  });

  it("lowers the open amount by cancellations and leaves none on the cancellation itself", () => {
    expect(entries.map((entry) => entry.openAmount)).toEqual([0, 690, 0, 0]);
    expect(entries.map((entry) => entry.isCredit)).toEqual([false, false, false, true]);
  });

  it("names the customer from the snapshot taken at finalisation", () => {
    expect(entries[0]?.customerName).toBe("Dachdeckerei Muster");
  });

  it("falls back to the customer id when no name is known", () => {
    const [entry] = ledgerEntries([{ ...TAX_INVOICES[0], customer_snapshot: null, customer: undefined } as never], []);
    expect(entry?.customerName).toBe("c-1");
  });
});
