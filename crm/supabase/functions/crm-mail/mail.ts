// Reading a parsed mail: who it is with, its text, date and attachments worth keeping, and whether
// it was sent by a machine (newsletters, notifications, auto-replies).
import PostalMime from "npm:postal-mime@2.4.4";
import { BODY_LIMIT } from "./config.ts";

export type Parsed = Awaited<ReturnType<typeof PostalMime.parse>>;
export type ParsedAttachment = Parsed["attachments"][number];
export type Direction = "in" | "out";
export type FolderKind = "inbox" | "sent";
export interface MailParty { address: string; name: string }
export interface Header { key: string; value: string }

const AUTOMATED_SENDER = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounce[s]?|notification[s]?|newsletter|news|info-noreply|alerts?|system|automated)([+._-].*)?@/i;
const INLINE_IMAGE_BYTES = 50_000;
const encoder = new TextEncoder();

export function parse(raw: Uint8Array): Promise<Parsed> {
  return PostalMime.parse(raw);
}

export function automatedReason(address: string, headers: Header[]): string | null {
  const header = (key: string) => headers.find((entry) => entry.key.toLowerCase() === key)?.value ?? "";
  if (AUTOMATED_SENDER.test(address)) return "Absender ist eine automatische Adresse";
  if (header("list-unsubscribe") !== "" || header("list-id") !== "") return "Newsletter oder Verteiler";
  const auto = header("auto-submitted").toLowerCase();
  if (auto !== "" && auto !== "no") return "Automatisch erzeugte Nachricht";
  if (/^(bulk|list|junk)$/i.test(header("precedence"))) return "Massenversand";
  return null;
}

export function headers(parsed: Parsed): Header[] {
  return (parsed.headers ?? []).map((header) => ({ key: String(header.key ?? ""), value: String(header.value ?? "") }));
}

/** Direction of the mail and every address outside the own domain it was exchanged with. */
export function parties(parsed: Parsed, ownDomain: string, folderKind: FolderKind): { direction: Direction; parties: MailParty[] } {
  const own = (address: string) => address.endsWith(`@${ownDomain}`);
  const from = (parsed.from?.address ?? "").toLowerCase();
  const direction: Direction = folderKind === "sent" || own(from) ? "out" : "in";
  const candidates = direction === "in"
    ? [{ address: from, name: parsed.from?.name ?? "" }]
    : [...(parsed.to ?? []), ...(parsed.cc ?? [])].map((entry) => ({ address: (entry.address ?? "").toLowerCase(), name: entry.name ?? "" }));
  return { direction, parties: candidates.filter((party) => party.address.includes("@") && !own(party.address)) };
}

export function plainText(parsed: Parsed): string {
  const text = parsed.text ?? (parsed.html ?? "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return text.replace(/\n{3,}/g, "\n\n").trim().slice(0, BODY_LIMIT);
}

export function mailDate(parsed: Parsed, fallback: Date): string {
  const date = parsed.date ? new Date(parsed.date) : fallback;
  return (Number.isNaN(date.getTime()) ? fallback : date).toISOString();
}

export function toBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === "string") return encoder.encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

/** Attachments without the small inline images of signatures and logos. */
export function keptAttachments(parsed: Parsed): ParsedAttachment[] {
  return (parsed.attachments ?? []).filter((file) =>
    !(file.disposition === "inline" && file.mimeType.startsWith("image/") && toBytes(file.content).length < INLINE_IMAGE_BYTES));
}

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss" };

export function safeName(name: string): string {
  return name.replace(/[äöüÄÖÜß]/g, (char) => UMLAUTS[char]).normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").slice(-100) || "anhang";
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice()));
  return Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function addressList(entries: { address?: string }[] | undefined): string[] {
  return (entries ?? []).map((entry) => (entry.address ?? "").toLowerCase()).filter((address) => address !== "");
}
