// Sample records for the unit tests.
import type { Invoice, LineItem, PaymentWithInvoice, SellerSnapshot } from "../api/types";

export const SELLER: SellerSnapshot = {
  name: "RepoCity", company_name: "RepoCity", owner_name: "Daniel Hütte", street: "Musterweg 1", postal_code: "48143", city: "Münster",
  country_code: "DE", email: "rechnung@example.org", phone: "0251 000000", vat_id: "", tax_number: "337/5000/0000",
  iban: "DE02 1203 0000 0000 2020 51", bic: "BYLADEM1001", bank_name: "Beispielbank", small_business: false, website: "",
};

export const ITEMS: LineItem[] = [
  { position: 1, product_id: null, title: "Webseite Basis & Pflege", description: "Fünf Seiten <inkl.> Texte", quantity: 1, unit: "Pauschal", unit_price_net: 1500, vat_rate: 19 },
  { position: 2, product_id: null, title: "Texte", description: "", quantity: 3, unit: "Stunde", unit_price_net: 80, vat_rate: 19 },
];

export const INVOICE: Invoice = {
  id: "inv-1", number: "RE-2026-0001", customer_id: "c-1", order_id: null, cancels_invoice_id: null, status: "open",
  issue_date: "2026-10-19", service_date: "2026-10-18", due_date: "2026-11-02", intro: "", outro: "", net: 1740, vat: 330.6, gross: 2070.6,
  paid_amount: 0, dunning_level: 0, seller_snapshot: SELLER,
  customer_snapshot: { name: "Muster GmbH", street: "Hauptstraße 2", postal_code: "48143", city: "Münster", country_code: "DE", email: "einkauf@example.com" },
  created_at: "2026-10-19T10:00:00Z",
};

const TAX_CUSTOMER = { name: "Dachdeckerei Muster", street: "Dachweg 3", postal_code: "48143", city: "Münster", country_code: "DE" };

/** An invoice of the 2026 tax fixture; the net is the gross without 19 % VAT. */
export function taxInvoice(id: string, number: string, issued: string, gross: number, cancels: string | null = null): Invoice {
  const net = Math.round((gross / 1.19) * 100) / 100;
  return {
    ...INVOICE, id, number, issue_date: issued, service_date: issued, cancels_invoice_id: cancels, gross, net,
    vat: Math.round((gross - net) * 100) / 100, paid_amount: 0, customer_snapshot: TAX_CUSTOMER,
  };
}

/** Three invoices of 2026, the last one cancelled by a cancellation invoice, as in the RadarAuditor tests. */
export const TAX_INVOICES: Invoice[] = [
  taxInvoice("inv-1", "RA-2026-0001", "2026-03-01", 464.1),
  taxInvoice("inv-2", "RA-2026-0002", "2026-04-01", 1190),
  taxInvoice("inv-3", "RA-2026-0003", "2026-05-01", 238),
  taxInvoice("inv-4", "RA-2026-0004", "2026-05-02", -238, "inv-3"),
];

/** The first invoice paid in full, the second in part. */
export const TAX_PAYMENTS: PaymentWithInvoice[] = [
  {
    id: "pay-1", invoice_id: "inv-1", amount: 464.1, paid_on: "2026-03-10", method: "transfer", reference: "Überweisung",
    invoice: { id: "inv-1", number: "RA-2026-0001", customer_snapshot: TAX_CUSTOMER },
  },
  {
    id: "pay-2", invoice_id: "inv-2", amount: 500, paid_on: "2026-04-20", method: "transfer", reference: "",
    invoice: { id: "inv-2", number: "RA-2026-0002", customer_snapshot: TAX_CUSTOMER },
  },
];
