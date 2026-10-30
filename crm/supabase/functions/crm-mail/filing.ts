// Files a mail with a known customer: the mail in crm.emails, its attachments as documents, and for
// an incoming mail of a customer with an unanswered quote a customer_mail triage row, so the server
// worker can recognise an acceptance or a decline, with the note whether the sender is verified.
import { TRIAGE_TEXT_LIMIT } from "./config.ts";
import { addressList, type Direction, headers, keptAttachments, mailDate, type Parsed, plainText, safeName, sha256, toBytes } from "./mail.ts";
import type { Directory, Report } from "./state.ts";
import { senderVerified } from "./verification.ts";

export interface EmailRow {
  customer_id: string;
  message_id: string;
  direction: Direction;
  from_address: string;
  from_name: string;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string;
  body_text: string;
  sent_at: string;
  folder: string;
  has_attachments: boolean;
}

export interface StoredAttachment {
  customerId: string;
  emailId: string;
  name: string;
  path: string;
  bytes: Uint8Array;
  type: string;
}

export interface CustomerMailTriage {
  kind: "customer_mail";
  status: "queued";
  direction: Direction;
  address: string;
  name: string;
  subject: string;
  body_text: string;
  folder: string;
  email_id: string;
  customer_id: string;
  /** Zoho confirmed by DMARC or an aligned DKIM signature that the mail comes from the From domain. */
  sender_verified: boolean;
}

export interface FilingStore {
  /** Inserts the mail; null when a mail with this Message-ID is already filed. */
  addEmail(row: EmailRow): Promise<string | null>;
  addAttachment(file: StoredAttachment): Promise<void>;
  queueCustomerMail(row: CustomerMailTriage): Promise<void>;
}

export interface MailToFile {
  customerId: string;
  parsed: Parsed;
  raw: Uint8Array;
  direction: Direction;
  folder: string;
}

async function emailRow(mail: MailToFile, hasAttachments: boolean): Promise<EmailRow> {
  const { parsed } = mail;
  return {
    customer_id: mail.customerId, message_id: parsed.messageId ?? `<${await sha256(mail.raw)}@crm.local>`, direction: mail.direction,
    from_address: (parsed.from?.address ?? "").toLowerCase(), from_name: parsed.from?.name ?? "", to_addresses: addressList(parsed.to),
    cc_addresses: addressList(parsed.cc), subject: (parsed.subject ?? "").slice(0, 500), body_text: plainText(parsed),
    sent_at: mailDate(parsed, new Date()), folder: mail.folder, has_attachments: hasAttachments,
  };
}

/** Only answers can accept a quote: incoming mails sent after the customer's first open quote. */
export function wantsCustomerTriage(dir: Directory, customerId: string, row: EmailRow): boolean {
  const since = dir.quoteSince.get(customerId);
  return row.direction === "in" && since !== undefined && Date.parse(row.sent_at) >= since;
}

function customerMailTriage(row: EmailRow, emailId: string, parsed: Parsed): CustomerMailTriage {
  return {
    kind: "customer_mail", status: "queued", direction: row.direction, address: row.from_address, name: row.from_name, subject: row.subject,
    body_text: row.body_text.slice(0, TRIAGE_TEXT_LIMIT), folder: row.folder, email_id: emailId, customer_id: row.customer_id,
    sender_verified: senderVerified(headers(parsed), row.from_address),
  };
}

export async function fileMail(store: FilingStore, dir: Directory, report: Report, mail: MailToFile): Promise<void> {
  const attachments = keptAttachments(mail.parsed);
  const row = await emailRow(mail, attachments.length > 0);
  const emailId = await store.addEmail(row);
  if (emailId === null) return;
  report.imported++;
  for (const file of attachments) {
    const name = file.filename ?? "anhang";
    const path = `customers/${mail.customerId}/mail/${emailId}/${safeName(name)}`;
    await store.addAttachment({ customerId: mail.customerId, emailId, name, path, bytes: toBytes(file.content), type: file.mimeType });
  }
  if (wantsCustomerTriage(dir, mail.customerId, row)) await store.queueCustomerMail(customerMailTriage(row, emailId, mail.parsed));
}
