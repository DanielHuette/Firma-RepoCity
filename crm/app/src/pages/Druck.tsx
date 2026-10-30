// Printable A4 document for a quote or an invoice; "Als PDF speichern" in the print dialog makes the PDF.
// Finalised invoices print from the snapshots taken at finalisation, so later edits of settings or
// customer data never change an issued invoice.
import { Fragment } from "preact";
import { useEffect } from "preact/hooks";
import { loadContract, loadCustomer, loadInvoice, loadQuote, loadSettings } from "../api/crm";
import type { Contract, Customer, LineItem, Party, SellerSnapshot, Settings } from "../api/types";
import { ErrorNote, Loading } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { date, euro, quantity } from "../lib/format";
import { documentTotals, lineNet } from "../lib/money";

interface Sheet {
  kind: "Angebot" | "Rechnung" | "Stornorechnung" | "Rechnungsentwurf";
  number: string;
  facts: [string, string][];
  intro: string;
  outro: string;
  items: LineItem[];
  seller: SellerSnapshot;
  buyer: Party;
  footerNote: string;
}

function sellerFromSettings(settings: Settings): SellerSnapshot {
  return { ...settings, name: settings.company_name };
}

function buyerFromCustomer(customer: Customer): Party {
  return { ...customer };
}

async function quoteSheet(id: string): Promise<Sheet> {
  const [{ quote, items }, settings] = await Promise.all([loadQuote(id), loadSettings()]);
  const customer = await loadCustomer(quote.customer_id);
  return {
    kind: "Angebot", number: quote.number, intro: quote.intro, outro: quote.outro, items,
    facts: [["Angebotsnummer", quote.number], ["Datum", date(quote.issue_date)], ["Gültig bis", date(quote.valid_until)]],
    seller: sellerFromSettings(settings), buyer: buyerFromCustomer(customer), footerNote: "",
  };
}

async function invoiceSheet(id: string): Promise<Sheet> {
  const [{ invoice, items }, settings] = await Promise.all([loadInvoice(id), loadSettings()]);
  const customer = await loadCustomer(invoice.customer_id);
  const seller = invoice.seller_snapshot ?? sellerFromSettings(settings);
  const kind = invoice.status === "draft" ? "Rechnungsentwurf" : invoice.cancels_invoice_id !== null ? "Stornorechnung" : "Rechnung";
  const facts: [string, string][] = [
    ["Rechnungsnummer", invoice.number ?? "wird beim Festschreiben vergeben"],
    ["Rechnungsdatum", date(invoice.issue_date)],
    ["Leistungsdatum", date(invoice.service_date)],
  ];
  if (invoice.due_date !== null && invoice.gross > 0) facts.push(["Zahlbar bis", date(invoice.due_date)]);
  return {
    kind, number: invoice.number ?? "Entwurf", facts, intro: invoice.intro, outro: invoice.outro, items, seller,
    buyer: invoice.customer_snapshot ?? buyerFromCustomer(customer),
    footerNote: invoice.gross > 0 && seller.iban !== "" ? `Bitte überweisen Sie den Betrag bis ${date(invoice.due_date)} unter Angabe der Rechnungsnummer ${invoice.number ?? ""}.` : "",
  };
}

export function Druck({ kind, id }: { kind: string; id: string }) {
  if (kind === "vertrag") return <ContractPrint id={id} />;
  return <SheetPrint kind={kind} id={id} />;
}

function SheetPrint({ kind, id }: { kind: string; id: string }) {
  const sheet = useAsync(() => (kind === "angebot" ? quoteSheet(id) : invoiceSheet(id)), [kind, id]);
  useEffect(() => {
    if (sheet.data === undefined) return;
    document.title = `${sheet.data.kind} ${sheet.data.number}`;
    const timer = window.setTimeout(() => { window.print(); }, 400);
    return () => { window.clearTimeout(timer); };
  }, [sheet.data]);
  if (sheet.error !== null) return <main class="page"><ErrorNote message={sheet.error} /></main>;
  if (sheet.data === undefined) return <main class="page"><Loading /></main>;
  return <Document sheet={sheet.data} />;
}

type Letterhead = Pick<SellerSnapshot, "company_name" | "owner_name" | "street" | "postal_code" | "city" | "phone" | "email" | "website" | "tax_number" | "vat_id" | "bank_name" | "iban" | "bic">;

function PrintActions() {
  return (
    <div class="print-actions no-print">
      <button class="button button--gold" type="button" onClick={() => { window.print(); }}>Drucken oder als PDF speichern</button>
      <button class="button" type="button" onClick={() => { window.close(); }}>Schließen</button>
    </div>
  );
}

function SheetHead({ seller }: { seller: Letterhead }) {
  return (
    <header class="sheet__head">
      <div class="sheet__brand">{seller.company_name}</div>
      <div class="sheet__sender">{[seller.company_name, seller.street, `${seller.postal_code} ${seller.city}`].join(" · ")}</div>
    </header>
  );
}

function SheetFoot({ seller }: { seller: Letterhead }) {
  return (
    <footer class="sheet__foot">
      <div>{seller.company_name}<br />{seller.owner_name}<br />{seller.street}<br />{seller.postal_code} {seller.city}</div>
      <div>{seller.phone !== undefined && seller.phone !== "" && <>Telefon {seller.phone}<br /></>}{seller.email}<br />{seller.website}</div>
      <div>{seller.tax_number !== "" && <>Steuernummer {seller.tax_number}<br /></>}{seller.vat_id !== undefined && seller.vat_id !== "" && <>USt-IdNr. {seller.vat_id}</>}</div>
      <div>{seller.bank_name}<br />{seller.iban !== "" && <>IBAN {seller.iban}<br /></>}{seller.bic !== "" && <>BIC {seller.bic}</>}</div>
    </footer>
  );
}

function Addressee({ sheet }: { sheet: Sheet }) {
  const { buyer } = sheet;
  return (
    <div class="sheet__top">
      <address class="sheet__address">
        <strong>{buyer.name}</strong><br />
        {buyer.contact_person !== undefined && buyer.contact_person !== "" && <>{buyer.contact_person}<br /></>}
        {buyer.street}<br />
        {buyer.postal_code} {buyer.city}
        {buyer.country_code !== "DE" && <><br />{buyer.country_code}</>}
      </address>
      <dl class="sheet__facts">
        {sheet.facts.map(([label, value]) => <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>)}
        {buyer.vat_id !== undefined && buyer.vat_id !== "" && <><dt>USt-IdNr. Kunde</dt><dd>{buyer.vat_id}</dd></>}
      </dl>
    </div>
  );
}

function SheetItems({ items, smallBusiness }: { items: LineItem[]; smallBusiness: boolean }) {
  const totals = documentTotals(items, smallBusiness);
  return (
    <>
      <table class="sheet__items">
        <thead><tr><th>Pos.</th><th>Leistung</th><th class="num">Menge</th><th class="num">Einzelpreis</th>{!smallBusiness && <th class="num">USt.</th>}<th class="num">Gesamt netto</th></tr></thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={index}>
              <td>{index + 1}</td>
              <td><strong>{item.title}</strong>{item.description !== "" && <div class="sheet__desc">{item.description}</div>}</td>
              <td class="num">{quantity(item.quantity)} {item.unit}</td>
              <td class="num">{euro(item.unit_price_net)}</td>
              {!smallBusiness && <td class="num">{item.vat_rate} %</td>}
              <td class="num">{euro(lineNet(item))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl class="sheet__totals">
        <dt>Summe netto</dt><dd>{euro(totals.net)}</dd>
        {!smallBusiness && totals.groups.map((group) => <Fragment key={group.rate}><dt>zzgl. {group.rate} % Umsatzsteuer</dt><dd>{euro(group.vat)}</dd></Fragment>)}
        <dt class="sheet__gross">Gesamtbetrag</dt><dd class="sheet__gross">{euro(totals.gross)}</dd>
      </dl>
    </>
  );
}

function Document({ sheet }: { sheet: Sheet }) {
  const { seller, buyer } = sheet;
  const salutation = buyer.contact_person !== undefined && buyer.contact_person !== "" ? `Guten Tag ${buyer.contact_person},` : "Sehr geehrte Damen und Herren,";
  return (
    <div class="print-root">
      <PrintActions />
      <article class="sheet">
        <SheetHead seller={seller} />
        <Addressee sheet={sheet} />
        <h1 class="sheet__title">{sheet.kind} {sheet.kind === "Rechnungsentwurf" ? "" : sheet.number}</h1>
        <p>{salutation}</p>
        <p>{sheet.intro}</p>
        <SheetItems items={sheet.items} smallBusiness={seller.small_business} />
        {seller.small_business && <p class="sheet__note">Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</p>}
        {sheet.footerNote !== "" && <p>{sheet.footerNote}</p>}
        <p>{sheet.outro}</p>
        <p>Mit freundlichen Grüßen<br />{seller.owner_name}</p>
        <SheetFoot seller={seller} />
      </article>
    </div>
  );
}

// Contracts print their rendered text as it was created, so later template edits never change them.
function ContractPrint({ id }: { id: string }) {
  const data = useAsync(async () => {
    const [contract, settings] = await Promise.all([loadContract(id), loadSettings()]);
    return { contract, settings };
  }, [id]);
  useEffect(() => {
    if (data.data === undefined) return;
    document.title = `${data.data.contract.title} ${data.data.contract.number}`;
  }, [data.data]);
  if (data.error !== null) return <main class="page"><ErrorNote message={data.error} /></main>;
  if (data.data === undefined) return <main class="page"><Loading /></main>;
  return <ContractSheet contract={data.data.contract} seller={data.data.settings} />;
}

function ContractSheet({ contract, seller }: { contract: Contract; seller: Settings }) {
  const [heading, ...rest] = contract.body.split("\n");
  return (
    <div class="print-root">
      <PrintActions />
      <article class="sheet">
        <SheetHead seller={seller} />
        <h1 class="sheet__title">{heading}</h1>
        <div class="sheet__body">{rest.join("\n").trim()}</div>
        <SheetFoot seller={seller} />
      </article>
    </div>
  );
}
