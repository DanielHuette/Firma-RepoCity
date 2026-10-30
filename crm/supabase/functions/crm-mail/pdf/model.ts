// Layout model of the generated PDFs: a document is a list of blocks that the renderer lays out on
// A4 pages with the seller's letterhead and footer. Builders produce blocks, so their content can be
// tested without drawing.

export interface Seller {
  company_name: string;
  owner_name: string;
  street: string;
  postal_code: string;
  city: string;
  country_code: string;
  email: string;
  phone: string;
  website: string;
  tax_number: string;
  vat_id: string;
  iban: string;
  bic: string;
  bank_name: string;
}

export interface Party {
  kind: string;
  name: string;
  contact_person: string;
  street: string;
  postal_code: string;
  city: string;
  country_code: string;
  vat_id: string;
  buyer_reference: string;
}

export interface Column {
  title: string;
  /** Share of the text width, all columns together 1. */
  width: number;
  align?: "left" | "right";
}

export interface TotalRow {
  label: string;
  value: string;
  strong?: boolean;
}

export type Block =
  | { kind: "title"; text: string }
  | { kind: "lines"; lines: string[]; small?: boolean }
  | { kind: "paragraph"; text: string; bold?: boolean }
  | { kind: "facts"; rows: [string, string][] }
  | { kind: "table"; columns: Column[]; rows: string[][] }
  | { kind: "totals"; rows: TotalRow[] }
  | { kind: "space"; height: number };

export interface PdfDocument {
  title: string;
  seller: Seller;
  blocks: Block[];
}

const SELLER_KEYS: (keyof Seller)[] = ["company_name", "owner_name", "street", "postal_code", "city", "country_code", "email", "phone",
  "website", "tax_number", "vat_id", "iban", "bic", "bank_name"];
const PARTY_KEYS: (keyof Party)[] = ["kind", "name", "contact_person", "street", "postal_code", "city", "country_code", "vat_id", "buyer_reference"];

function textFields<K extends string>(value: unknown, keys: K[]): Record<K, string> {
  const source = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, typeof source[key] === "string" ? source[key] : ""])) as Record<K, string>;
}

/** Seller fields from a settings row or an invoice's seller snapshot; missing fields stay empty. */
export function toSeller(value: unknown): Seller {
  return textFields(value, SELLER_KEYS);
}

/** Customer fields from a customer row or an invoice's customer snapshot; missing fields stay empty. */
export function toParty(value: unknown): Party {
  return textFields(value, PARTY_KEYS);
}

export function sellerLine(seller: Seller): string {
  return [seller.company_name, seller.owner_name, seller.street, `${seller.postal_code} ${seller.city}`.trim()]
    .filter((part) => part !== "").join(" · ");
}

export function addressLines(party: Party): string[] {
  const attention = party.kind === "company" && party.contact_person !== "" ? `z. Hd. ${party.contact_person}` : "";
  const country = party.country_code !== "" && party.country_code !== "DE" ? party.country_code : "";
  return [party.name, attention, party.street, `${party.postal_code} ${party.city}`.trim(), country].filter((line) => line !== "");
}

export function salutation(party: Party): string {
  const person = party.kind === "company" ? party.contact_person : party.contact_person || party.name;
  return person !== "" ? `Guten Tag ${person},` : "Sehr geehrte Damen und Herren,";
}

/** Sender line, recipient address and a gap: the head of every letter. */
export function letterHead(seller: Seller, recipient: Party): Block[] {
  return [{ kind: "lines", lines: [sellerLine(seller)], small: true }, { kind: "lines", lines: addressLines(recipient) }, { kind: "space", height: 24 }];
}
