// Mail worker of the RepoCity CRM, run every five minutes by pg_cron and on demand from the app.
// Context: Supabase Edge Function (Deno). One run sends the queued outgoing mails with their PDFs,
// files the senders the server worker has classified, reads new mails of inbox and sent folder into
// the customer files or the triage store, fetches the history of new customer addresses and renders
// the PDF of every finalised invoice that has none. | Input: mailbox access from Supabase Vault, the
// crm schema, RadarAuditor documents. | Output: crm.emails, crm.documents, crm.mail_triage,
// crm.mail_review, crm.outbox status, crm.mail_sync state, files in crm-documents.
import { IMAP_HOST, WALL_BUDGET_MS } from "./config.ts";
import { Attachments, renderMissingInvoices } from "./documents.ts";
import { errorText, WorkerError } from "./errors.ts";
import { fileMail } from "./filing.ts";
import { Imap } from "./imap.ts";
import { parse, parties, sha256 } from "./mail.ts";
import { sendOutbox, type Transport } from "./outbox.ts";
import type { Seller } from "./pdf/model.ts";
import { patch, rpc, select, selectAll, upsert } from "./rest.ts";
import { buildMime, Smtp } from "./smtp.ts";
import { type Directory, emptyDirectory, newReport, type Report } from "./state.ts";
import { documentStore, filingStore, outboxStore, triageStore } from "./stores.ts";
import { backfill, type Folder, type MailboxRun, syncFolder } from "./sync.ts";
import { applyVerdicts, type FileRaw } from "./triage.ts";

const REFUSED = "Anmeldung am Postfach abgelehnt. Bitte ein App-Passwort von Zoho hinterlegen.";
const LEASE_SECONDS = 170;

interface Mailbox { address: string; password: string }

async function mailbox(): Promise<Mailbox> {
  const secrets = await rpc<Record<string, string> | null>("mail_config", {});
  const config = { address: secrets?.crm_mail_address ?? "", password: secrets?.crm_mail_password ?? "" };
  if (config.address === "" || config.password === "") throw new WorkerError("Zugangsdaten für das Postfach fehlen.");
  return config;
}

async function loadDirectory(ownDomain: string): Promise<Directory> {
  const [customers, ignored, reviews, triage, quotes] = await Promise.all([
    selectAll<{ id: string; email: string }>("customers?select=id,email&email=not.is.null&order=created_at"),
    selectAll<{ address: string }>("mail_ignore?select=address&order=address"),
    selectAll<{ id: string; address: string; mail_count: number; status: string }>("mail_review?select=id,address,mail_count,status&order=created_at"),
    selectAll<{ id: string; address: string }>("mail_triage?kind=eq.unknown_sender&status=neq.applied&select=id,address&order=created_at"),
    selectAll<{ customer_id: string; sent_at: string | null }>("quotes?status=eq.sent&select=customer_id,sent_at&order=sent_at"),
  ]);
  const dir = emptyDirectory(ownDomain);
  for (const row of customers) dir.customers.set(row.email.toLowerCase(), row.id);
  for (const row of ignored) dir.ignored.add(row.address.toLowerCase());
  for (const row of reviews) dir.reviews.set(row.address.toLowerCase(), { id: row.id, mail_count: row.mail_count, status: row.status });
  for (const row of triage) if (!dir.triage.has(row.address)) dir.triage.set(row.address, row.id);
  for (const row of quotes) if (row.sent_at !== null && !dir.quoteSince.has(row.customer_id)) dir.quoteSince.set(row.customer_id, Date.parse(row.sent_at));
  return dir;
}

// A refused password is tried only once: repeated failed logins would get the account locked.
async function openMailbox(config: Mailbox): Promise<Imap> {
  const fingerprint = await sha256(new TextEncoder().encode(`${config.address}:${config.password}`));
  const lease = await select<{ auth_failed_hash: string }[]>("worker_lease?id=eq.1&select=auth_failed_hash");
  if (lease[0]?.auth_failed_hash === fingerprint) throw new WorkerError(REFUSED);
  try {
    return await Imap.open(IMAP_HOST, config.address, config.password);
  } catch (error) {
    if (!/AUTHENTICATIONFAILED|Invalid credentials/i.test(errorText(error))) throw new WorkerError(errorText(error));
    await patch("worker_lease", "id=eq.1", { auth_failed_hash: fingerprint });
    throw new WorkerError(REFUSED);
  }
}

function smtpTransport(config: Mailbox, seller: Seller, ownDomain: string): Transport {
  const fromName = seller.owner_name !== "" ? `${seller.owner_name}${seller.company_name !== "" ? ` | ${seller.company_name}` : ""}` : seller.company_name;
  return {
    async send(mail, attachment) {
      const messageId = `<${crypto.randomUUID()}@${ownDomain}>`;
      const message = buildMime({ fromName, from: config.address, to: mail.to_address, subject: mail.subject, body: mail.body, messageId,
        attachment: attachment ?? undefined, listUnsubscribe: mail.list_unsubscribe });
      await Smtp.send(config.address, config.password, config.address, mail.to_address, message);
      return { messageId, fromName };
    },
  };
}

function fileStoredMail(dir: Directory, report: Report): FileRaw {
  return async (customerId, raw, folder) => {
    const parsed = await parse(raw);
    const { direction } = parties(parsed, dir.ownDomain, "inbox");
    await fileMail(filingStore, dir, report, { customerId, parsed, raw, direction, folder: folder ?? dir.folders[direction] });
  };
}

async function readMailbox(run: MailboxRun): Promise<void> {
  const { inbox, sent } = await run.imap.folders();
  run.dir.folders = { in: inbox, out: sent ?? inbox };
  const folders: Folder[] = [{ name: inbox, kind: "inbox" }, ...(sent === null ? [] : [{ name: sent, kind: "sent" as const }])];
  await applyVerdicts(triageStore, run.dir, run.report, fileStoredMail(run.dir, run.report));
  for (const folder of folders) await syncFolder(run, folder);
  await backfill(run, folders);
}

async function runLeased(report: Report): Promise<void> {
  const started = Date.now();
  const hasTime = () => Date.now() - started < WALL_BUDGET_MS;
  const config = await mailbox();
  const ownDomain = config.address.split("@")[1].toLowerCase();
  const [dir, seller] = await Promise.all([loadDirectory(ownDomain), documentStore.seller()]);
  const imap = await openMailbox(config);
  try {
    const transport = smtpTransport(config, seller, ownDomain);
    await sendOutbox({ store: outboxStore(config.address), attachments: new Attachments(documentStore, config.address), transport, report, now: Date.now, hasTime });
    await readMailbox({ imap, dir, report, filing: filingStore, triage: triageStore, hasTime });
    await renderMissingInvoices(documentStore, report, hasTime);
  } finally {
    await imap.close();
  }
}

export async function run(): Promise<Report> {
  const report = newReport();
  if (!(await rpc<boolean>("acquire_mail_lease", { p_seconds: LEASE_SECONDS }))) return { ...report, errors: ["Ein Abruf läuft bereits."] };
  try {
    await runLeased(report);
  } catch (error) {
    const message = errorText(error);
    report.errors.push(message);
    await upsert("mail_sync", "folder", { folder: "INBOX", last_error: message.slice(0, 300) }).catch(() => undefined);
  } finally {
    await rpc("release_mail_lease", {}).catch(() => undefined);
  }
  return report;
}
