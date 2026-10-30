// The invoice PDF must carry every field § 14 Abs. 4 UStG asks for, the note § 34a UStDV requires
// for small businesses, and a cancellation invoice must name the invoice it cancels.
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { assert, assertEquals, assertFalse, assertThrows } from "jsr:@std/assert@1";
import { invoiceBlocks, invoicePdf, toInvoiceData } from "./invoice.ts";
import { pdfText } from "../testing/pdf_text.ts";
import { customer, seller } from "../testing/fixtures.ts";

const item = (position: number, quantity: number, price: number, rate = 19) =>
  ({ position, title: `Leistung ${String(position)}`, description: "Einrichtung der Webseite", quantity, unit: "Stück", unit_price_net: price, vat_rate: rate });

function invoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    number: "RE-2026-0007", issue_date: "2026-10-24", service_date: "2026-10-20", due_date: "2026-11-07",
    intro: "für die erbrachten Leistungen erlaube ich mir, folgende Rechnung zu stellen:", outro: "Vielen Dank für Ihren Auftrag.",
    net: 500, vat: 0, gross: 500, seller_snapshot: { ...seller, small_business: true }, customer_snapshot: customer,
    invoice_items: [item(1, 2, 250)], ...overrides,
  };
}

const standardVat = invoiceRow({
  net: 200.5, vat: 26.1, gross: 226.6, seller_snapshot: { ...seller, small_business: false, vat_id: "DE123456789" },
  invoice_items: [item(1, 1, 100.5, 19), item(2, 2, 50, 7)],
});

async function textOf(row: Record<string, unknown>, original: { number: string; issue_date: string } | null = null): Promise<string[]> {
  return pdfText(await invoicePdf(toInvoiceData(row, original)));
}

Deno.test("small business invoice shows every mandatory field and the § 19 note", async () => {
  const text = await textOf(invoiceRow());
  for (const expected of ["Rechnung", "Beispielfirma · Erika Beispiel · Musterweg 1 · 48143 Münster", "Bäckerei Größe GmbH", "z. Hd. Jürgen Weiß",
    "Hauptstraße 5", "48143 Münster", "Steuernummer", "337/5000/0000", "Rechnungsdatum", "24.10.2026", "Rechnungsnummer", "RE-2026-0007",
    "Leistungsdatum", "20.10.2026", "Leistung 1", "Einrichtung der Webseite", "2 Stück", "250,00 €", "Gesamtbetrag", "500,00 €"]) {
    assert(text.includes(expected), `missing: ${expected}`);
  }
  assert(text.some((run) => run.includes("Steuerbefreiung für Kleinunternehmer nach § 19 Abs. 1 UStG")));
  assert(text.some((run) => run.includes("bis zum 07.11.2026")));
  assertFalse(text.some((run) => run.startsWith("Umsatzsteuer")));
});

Deno.test("standard invoice splits the net amount by rate and names rate and tax amount", async () => {
  const text = await textOf(standardVat);
  for (const expected of ["Summe netto", "200,50 €", "Umsatzsteuer 19 % auf 100,50 €", "19,10 €", "Umsatzsteuer 7 % auf 100,00 €", "7,00 €",
    "Gesamtbetrag", "226,60 €", "USt-IdNr.", "DE123456789", "19 %", "7 %"]) {
    assert(text.includes(expected), `missing: ${expected}`);
  }
  assertFalse(text.some((run) => run.includes("§ 19")));
});

Deno.test("cancellation invoice is marked as such and refers to the original invoice", async () => {
  const row = invoiceRow({ number: "RE-2026-0008", gross: -500, net: -500, invoice_items: [item(1, -2, 250)], intro: "hiermit storniere ich die Rechnung RE-2026-0007 vom 24.10.2026." });
  const text = await textOf(row, { number: "RE-2026-0007", issue_date: "2026-10-24" });
  assertEquals(text.filter((run) => run === "Stornorechnung").length, 1);
  assert(text.includes("Storniert"));
  assert(text.includes("Rechnung RE-2026-0007 vom 24.10.2026"));
  assert(text.includes("-500,00 €"));
  assertFalse(text.some((run) => run.includes("überweisen")));
});

Deno.test("the layout model carries the fields without drawing", () => {
  const blocks = invoiceBlocks(toInvoiceData(invoiceRow(), null));
  assertEquals(blocks.find((block) => block.kind === "title"), { kind: "title", text: "Rechnung" });
  const facts = blocks.find((block) => block.kind === "facts");
  assert(facts?.kind === "facts" && facts.rows.some(([label, value]) => label === "Leistungsdatum" && value === "20.10.2026"));
});

Deno.test("an invoice without stored seller data is refused instead of printed with live data", () => {
  assertThrows(() => toInvoiceData(invoiceRow({ seller_snapshot: null }), null), Error, "RE-2026-0007");
  assertThrows(() => toInvoiceData(invoiceRow({ number: null }), null), Error, "Rechnungsnummer");
});

Deno.test("an invoice with many items runs over several pages and ends with the total", async () => {
  const items = Array.from({ length: 60 }, (_, index) => item(index + 1, 1, 10));
  const bytes = await invoicePdf(toInvoiceData(invoiceRow({ invoice_items: items, net: 600, gross: 600 }), null));
  const text = await pdfText(bytes);
  assert((await PDFDocument.load(bytes)).getPageCount() > 1);
  assert(text.indexOf("Gesamtbetrag") > text.indexOf("Leistung 60"));
  assert(text.includes("600,00 €"));
});

Deno.test("a monthly invoice names its service period instead of a single date of service", async () => {
  const text = await textOf(invoiceRow({ service_date: "2026-11-01", service_period_end: "2026-11-30" }));
  assert(text.includes("Leistungszeitraum"));
  assert(text.includes("01.11.2026 – 30.11.2026"));
  assertFalse(text.includes("Leistungsdatum"));
});

Deno.test("an invoice without period end keeps the date of service", async () => {
  const text = await textOf(invoiceRow({ service_period_end: null }));
  assert(text.includes("Leistungsdatum"));
  assertFalse(text.includes("Leistungszeitraum"));
});
