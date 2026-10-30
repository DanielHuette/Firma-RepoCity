// Quote PDF rendered by the CRM when no audit-plus-quote PDF of the RadarAuditor exists. A quote
// has no stored snapshot, so it uses the current company settings and customer data.
import { WorkerError } from "../errors.ts";
import { type Item, itemTable, SMALL_BUSINESS_NOTE, type Totals, toItems, totalRows } from "./items.ts";
import { type Block, letterHead, type Party, salutation, type Seller, toParty, toSeller } from "./model.ts";
import { renderPdf } from "./render.ts";
import { dateDe } from "./text.ts";

export interface QuoteData {
  number: string;
  issueDate: string;
  validUntil: string;
  intro: string;
  outro: string;
  totals: Totals;
  smallBusiness: boolean;
  seller: Seller;
  customer: Party;
  items: Item[];
}

/** A quote row with embedded quote_items and customers, and the settings row. */
export function toQuoteData(row: Record<string, unknown>, settings: Record<string, unknown>): QuoteData {
  const number = String(row.number ?? "");
  if (row.customers == null) throw new WorkerError(`Angebot ${number}: Kundendaten fehlen.`);
  return {
    number, issueDate: String(row.issue_date ?? ""), validUntil: String(row.valid_until ?? ""), intro: String(row.intro ?? ""),
    outro: String(row.outro ?? ""), totals: { net: Number(row.net ?? 0), vat: Number(row.vat ?? 0), gross: Number(row.gross ?? 0) },
    smallBusiness: settings.small_business === true, seller: toSeller(settings), customer: toParty(row.customers), items: toItems(row.quote_items),
  };
}

export function quoteBlocks(quote: QuoteData): Block[] {
  return [
    ...letterHead(quote.seller, quote.customer),
    { kind: "title", text: "Angebot" },
    { kind: "facts", rows: [["Angebotsnummer", quote.number], ["Angebotsdatum", dateDe(quote.issueDate)], ["Gültig bis", dateDe(quote.validUntil)]] },
    { kind: "space", height: 16 },
    { kind: "paragraph", text: salutation(quote.customer) }, { kind: "paragraph", text: quote.intro },
    itemTable(quote.items, !quote.smallBusiness),
    { kind: "totals", rows: totalRows(quote.items, quote.totals, quote.smallBusiness) },
    ...(quote.smallBusiness ? [{ kind: "paragraph", text: SMALL_BUSINESS_NOTE } as Block] : []),
    { kind: "paragraph", text: quote.outro },
    { kind: "paragraph", text: `Mit freundlichen Grüßen\n${quote.seller.owner_name || quote.seller.company_name}` },
  ];
}

export function quotePdf(quote: QuoteData): Promise<Uint8Array> {
  return renderPdf({ title: `Angebot ${quote.number}`, seller: quote.seller, blocks: quoteBlocks(quote) });
}
