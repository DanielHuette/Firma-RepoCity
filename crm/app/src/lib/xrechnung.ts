// Builds an XRechnung 3.0 file in the UN/CEFACT CII syntax from a finalised invoice.
// Context: German B2B e-invoicing; the element order follows the CII schema. | Input: invoice,
// its items and the snapshots taken at finalisation. | Output: XML text.
import type { Invoice, LineItem, Party, SellerSnapshot } from "../api/types";
import { documentTotals, lineNet, roundCents, type Totals } from "./money";

const SPECIFICATION = "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";
const PROCESS = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
const SMALL_BUSINESS_REASON = "Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG";

const UNIT_CODES: Record<string, string> = {
  "stück": "C62", "stk": "C62", "stunde": "HUR", "std": "HUR", "stunden": "HUR", "monat": "MON", "monate": "MON",
  "tag": "DAY", "tage": "DAY", "pauschal": "LS", "seite": "C62", "paket": "C62",
};

export class XRechnungError extends Error {
  override name = "XRechnungError";
}

export function unitCode(unit: string): string {
  return UNIT_CODES[unit.trim().toLowerCase()] ?? "C62";
}

export function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function day(value: string): string {
  return value.replace(/-/g, "");
}

function amount(value: number): string {
  return roundCents(value).toFixed(2);
}

function element(name: string, content: string, attributes = ""): string {
  return `<${name}${attributes === "" ? "" : ` ${attributes}`}>${content}</${name}>`;
}

function text(name: string, value: string, attributes = ""): string {
  return element(name, escapeXml(value), attributes);
}

function address(party: Party): string {
  return element("ram:PostalTradeAddress",
    text("ram:PostcodeCode", party.postal_code) + text("ram:LineOne", party.street) + text("ram:CityName", party.city) + text("ram:CountryID", party.country_code === "" ? "DE" : party.country_code));
}

function sellerParty(seller: SellerSnapshot): string {
  const contact = element("ram:DefinedTradeContact",
    text("ram:PersonName", seller.owner_name === "" ? seller.company_name : seller.owner_name)
    + element("ram:TelephoneUniversalCommunication", text("ram:CompleteNumber", seller.phone === undefined || seller.phone === "" ? "-" : seller.phone))
    + element("ram:EmailURIUniversalCommunication", text("ram:URIID", seller.email ?? "")));
  const registrations = [
    seller.tax_number === "" ? "" : element("ram:SpecifiedTaxRegistration", text("ram:ID", seller.tax_number, 'schemeID="FC"')),
    seller.vat_id === "" || seller.vat_id === undefined ? "" : element("ram:SpecifiedTaxRegistration", text("ram:ID", seller.vat_id, 'schemeID="VA"')),
  ].join("");
  return element("ram:SellerTradeParty",
    text("ram:Name", seller.company_name) + contact + address(seller)
    + element("ram:URIUniversalCommunication", text("ram:URIID", seller.email ?? "", 'schemeID="EM"')) + registrations);
}

function buyerParty(buyer: Party): string {
  const vat = buyer.vat_id === undefined || buyer.vat_id === "" ? "" : element("ram:SpecifiedTaxRegistration", text("ram:ID", buyer.vat_id, 'schemeID="VA"'));
  const mail = buyer.email === undefined || buyer.email === null || buyer.email === "" ? "" : element("ram:URIUniversalCommunication", text("ram:URIID", buyer.email, 'schemeID="EM"'));
  return element("ram:BuyerTradeParty", text("ram:Name", buyer.name) + address(buyer) + mail + vat);
}

function lineItem(item: LineItem, index: number, sign: number, smallBusiness: boolean): string {
  const category = smallBusiness ? "E" : item.vat_rate === 0 ? "Z" : "S";
  const rate = smallBusiness ? 0 : item.vat_rate;
  return element("ram:IncludedSupplyChainTradeLineItem",
    element("ram:AssociatedDocumentLineDocument", text("ram:LineID", String(index + 1)))
    + element("ram:SpecifiedTradeProduct", text("ram:Name", item.title) + (item.description === "" ? "" : text("ram:Description", item.description)))
    + element("ram:SpecifiedLineTradeAgreement", element("ram:NetPriceProductTradePrice", text("ram:ChargeAmount", amount(item.unit_price_net))))
    + element("ram:SpecifiedLineTradeDelivery", text("ram:BilledQuantity", String(sign * item.quantity), `unitCode="${unitCode(item.unit)}"`))
    + element("ram:SpecifiedLineTradeSettlement",
      element("ram:ApplicableTradeTax", text("ram:TypeCode", "VAT") + text("ram:CategoryCode", category) + text("ram:RateApplicablePercent", rate.toFixed(2)))
      + element("ram:SpecifiedTradeSettlementLineMonetarySummation", text("ram:LineTotalAmount", amount(sign * lineNet(item))))));
}

interface Finalised {
  invoice: Invoice;
  number: string;
  issueDate: string;
  seller: SellerSnapshot;
  buyer: Party;
  totals: Totals;
}

function finalised(invoice: Invoice, items: LineItem[], sign: number): Finalised {
  const { seller_snapshot: seller, customer_snapshot: buyer, number, issue_date: issueDate } = invoice;
  if (invoice.status === "draft" || number === null || issueDate === null || seller === null || buyer === null) {
    throw new XRechnungError("Eine E-Rechnung gibt es erst für festgeschriebene Rechnungen.");
  }
  if (seller.email === "" || seller.email === undefined || seller.email === null) {
    throw new XRechnungError("Für die E-Rechnung fehlt die E-Mail-Adresse in den Einstellungen.");
  }
  if (items.length === 0) throw new XRechnungError("Die Rechnung hat keine Positionen.");
  const totals = documentTotals(items.map((item) => ({ ...item, quantity: sign * item.quantity })), seller.small_business);
  return { invoice, number, issueDate, seller, buyer, totals };
}

function taxBreakdown(totals: Totals, smallBusiness: boolean): string {
  return totals.groups.map((group) => {
    const category = smallBusiness ? "E" : group.rate === 0 ? "Z" : "S";
    return element("ram:ApplicableTradeTax",
      text("ram:CalculatedAmount", amount(group.vat)) + text("ram:TypeCode", "VAT")
      + (smallBusiness ? text("ram:ExemptionReason", SMALL_BUSINESS_REASON) : "")
      + text("ram:BasisAmount", amount(group.net)) + text("ram:CategoryCode", category)
      + text("ram:RateApplicablePercent", (smallBusiness ? 0 : group.rate).toFixed(2)));
  }).join("");
}

function paymentTerms(invoice: Invoice): string {
  const due = invoice.due_date === null ? "" : element("ram:DueDateDateTime", text("udt:DateTimeString", day(invoice.due_date), 'format="102"'));
  return element("ram:SpecifiedTradePaymentTerms",
    text("ram:Description", invoice.due_date === null ? "Zahlbar sofort." : `Zahlbar ohne Abzug bis ${invoice.due_date.split("-").reverse().join(".")}.`) + due);
}

function settlement(document: Finalised): string {
  const { seller, totals } = document;
  const means = seller.iban === "" ? "" : element("ram:SpecifiedTradeSettlementPaymentMeans",
    text("ram:TypeCode", "58") + element("ram:PayeePartyCreditorFinancialAccount", text("ram:IBANID", seller.iban.replace(/\s/g, ""))));
  const summation = element("ram:SpecifiedTradeSettlementHeaderMonetarySummation",
    text("ram:LineTotalAmount", amount(totals.net)) + text("ram:TaxBasisTotalAmount", amount(totals.net))
    + text("ram:TaxTotalAmount", amount(totals.vat), 'currencyID="EUR"') + text("ram:GrandTotalAmount", amount(totals.gross))
    + text("ram:DuePayableAmount", amount(totals.gross)));
  return element("ram:ApplicableHeaderTradeSettlement",
    text("ram:PaymentReference", document.number) + text("ram:InvoiceCurrencyCode", "EUR") + means
    + taxBreakdown(totals, seller.small_business) + paymentTerms(document.invoice) + summation);
}

function transaction(document: Finalised, items: LineItem[], sign: number): string {
  const { invoice, seller, buyer } = document;
  return element("rsm:SupplyChainTradeTransaction",
    items.map((item, index) => lineItem(item, index, sign, seller.small_business)).join("")
    + element("ram:ApplicableHeaderTradeAgreement",
      text("ram:BuyerReference", buyer.buyer_reference !== undefined && buyer.buyer_reference !== "" ? buyer.buyer_reference : document.number)
      + sellerParty(seller) + buyerParty(buyer))
    + element("ram:ApplicableHeaderTradeDelivery",
      invoice.service_date === null ? "" : element("ram:ActualDeliverySupplyChainEvent",
        element("ram:OccurrenceDateTime", text("udt:DateTimeString", day(invoice.service_date), 'format="102"'))))
    + settlement(document));
}

const NAMESPACES = 'xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" '
  + 'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" '
  + 'xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" '
  + 'xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"';

/**
 * Creates the XML. A cancellation (negative total) becomes a credit note (type 381) with positive
 * amounts, as the standard expects.
 *
 * @throws XRechnungError if the invoice is still a draft or mandatory data is missing.
 */
export function buildXRechnung(invoice: Invoice, items: LineItem[]): string {
  const sign = invoice.gross < 0 ? -1 : 1;
  const document = finalised(invoice, items, sign);
  const notes = document.seller.small_business ? element("ram:IncludedNote", text("ram:Content", SMALL_BUSINESS_REASON)) : "";
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + element("rsm:CrossIndustryInvoice",
    element("rsm:ExchangedDocumentContext",
      element("ram:BusinessProcessSpecifiedDocumentContextParameter", text("ram:ID", PROCESS))
      + element("ram:GuidelineSpecifiedDocumentContextParameter", text("ram:ID", SPECIFICATION)))
    + element("rsm:ExchangedDocument",
      text("ram:ID", document.number) + text("ram:TypeCode", sign < 0 ? "381" : "380")
      + element("ram:IssueDateTime", text("udt:DateTimeString", day(document.issueDate), 'format="102"')) + notes)
    + transaction(document, items, sign),
    NAMESPACES);
}
