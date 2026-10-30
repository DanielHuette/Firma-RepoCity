import { assert, assertEquals, assertFalse, assertThrows } from "jsr:@std/assert@1";
import { dunningPdf, dunningTitle, toDunningData } from "./dunning.ts";
import { quotePdf, toQuoteData } from "./quote.ts";
import { pdfText } from "../testing/pdf_text.ts";
import { customer, seller } from "../testing/fixtures.ts";

const settings = { ...seller, small_business: true };

const quoteRow = {
  number: "AN-2026-0004", issue_date: "2026-10-24", valid_until: "2026-11-23", intro: "gern biete ich Ihnen an:", outro: "Ich freue mich auf Ihre Rückmeldung.",
  net: 1290, vat: 0, gross: 1290, customers: customer,
  quote_items: [
    { position: 2, title: "Wartung", description: "monatlich", quantity: 1, unit: "Monat", unit_price_net: 90, vat_rate: 19 },
    { position: 1, title: "Webseite", description: "", quantity: 1, unit: "Stück", unit_price_net: 1200, vat_rate: 19 },
  ],
};

Deno.test("quote PDF names number, dates, items in order and the total", async () => {
  const text = await pdfText(await quotePdf(toQuoteData(quoteRow, settings)));
  for (const expected of ["Angebot", "Angebotsnummer", "AN-2026-0004", "Angebotsdatum", "24.10.2026", "Gültig bis", "23.11.2026",
    "Bäckerei Größe GmbH", "Gesamtbetrag", "1.290,00 €", "1.200,00 €", "90,00 €"]) {
    assert(text.includes(expected), `missing: ${expected}`);
  }
  assert(text.indexOf("Webseite") < text.indexOf("Wartung"));
  assert(text.some((run) => run.includes("§ 19 Abs. 1 UStG")));
});

Deno.test("a quote without its customer is refused", () => {
  assertThrows(() => toQuoteData({ ...quoteRow, customers: null }, settings), Error, "AN-2026-0004");
});

const invoice = { number: "RE-2026-0007", issue_date: "2026-10-01", due_date: "2026-10-15", gross: 500, paid_amount: 120, dunning_level: 1, customers: customer };

Deno.test("reminder letter names invoice, open amount, original due date and level", async () => {
  const text = await pdfText(await dunningPdf(toDunningData(invoice, 2, settings, "2026-10-24")));
  for (const expected of ["1. Mahnung", "Rechnung", "RE-2026-0007", "Rechnungsdatum", "01.10.2026", "Ursprünglich fällig am", "15.10.2026",
    "Mahnstufe", "2 von 3", "Rechnungsbetrag", "500,00 €", "Bereits bezahlt", "120,00 €", "Offener Betrag", "380,00 €", "24.10.2026"]) {
    assert(text.includes(expected), `missing: ${expected}`);
  }
  assert(text.some((run) => run.includes("DE02 1203 0000 0000 2020 51")));
});

Deno.test("reminder titles follow the three levels", () => {
  assertEquals([1, 2, 3].map(dunningTitle), ["Zahlungserinnerung", "1. Mahnung", "2. Mahnung"]);
});

Deno.test("the first reminder leaves out an empty paid line", async () => {
  const text = await pdfText(await dunningPdf(toDunningData({ ...invoice, paid_amount: 0 }, 1, settings, "2026-10-24")));
  assert(text.includes("Zahlungserinnerung"));
  assertFalse(text.includes("Bereits bezahlt"));
});

Deno.test("a reminder level outside one to three is refused", () => {
  assertThrows(() => toDunningData(invoice, 4, settings, "2026-10-24"), Error, "Mahnstufe");
});
