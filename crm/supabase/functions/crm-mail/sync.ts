// Reads the mailbox: new mails of inbox and sent folder since the last run, and once per new or
// changed customer address the mail history with that address. Every mail goes either to the
// customer file or, from an unknown sender, to the triage store.
import { BACKFILL_BATCH, BATCH, INITIAL_DAYS, MAX_MAIL_BYTES } from "./config.ts";
import { errorText } from "./errors.ts";
import { fileMail, type FilingStore } from "./filing.ts";
import { type Imap, quote } from "./imap.ts";
import { type FolderKind, parse, parties } from "./mail.ts";
import { patch, select, upsert } from "./rest.ts";
import type { Directory, Report } from "./state.ts";
import { parkUnknown, type TriageStore } from "./triage.ts";

export interface MailboxRun {
  imap: Imap;
  dir: Directory;
  report: Report;
  filing: FilingStore;
  triage: TriageStore;
  hasTime: () => boolean;
}

export interface Folder { name: string; kind: FolderKind }

const MAX_PARTIES = 3;

async function processMessage(run: MailboxRun, raw: Uint8Array, folder: Folder, only?: string): Promise<void> {
  const parsed = await parse(raw);
  const { direction, parties: found } = parties(parsed, run.dir.ownDomain, folder.kind);
  const others = found.filter((party) => only === undefined || party.address === only);
  const known = others.find((party) => run.dir.customers.has(party.address));
  if (known !== undefined) {
    const customerId = run.dir.customers.get(known.address) ?? "";
    return fileMail(run.filing, run.dir, run.report, { customerId, parsed, raw, direction, folder: folder.name });
  }
  if (only !== undefined) return;
  for (const party of others.slice(0, MAX_PARTIES)) {
    await parkUnknown(run.triage, run.dir, run.report, { parsed, raw, direction, party, folder: folder.name });
  }
}

async function fetchAndProcess(run: MailboxRun, uid: number, folder: Folder, only?: string): Promise<void> {
  const size = await run.imap.size(uid);
  const raw = size > MAX_MAIL_BYTES ? await run.imap.fetch(uid, "BODY.PEEK[HEADER]") : await run.imap.fetch(uid);
  if (raw === null) return;
  try {
    await processMessage(run, raw, folder, only);
  } catch (error) {
    run.report.errors.push(`${folder.name} ${String(uid)}: ${errorText(error)}`);
  }
}

function imapDate(date: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(date.getUTCDate())}-${months[date.getUTCMonth()]}-${String(date.getUTCFullYear())}`;
}

async function newUids(imap: Imap, lastUid: number): Promise<number[]> {
  if (lastUid === 0) return imap.search(`SINCE ${imapDate(new Date(Date.now() - INITIAL_DAYS * 86_400_000))}`);
  return (await imap.search(`UID ${String(lastUid + 1)}:*`)).filter((uid) => uid > lastUid);
}

export async function syncFolder(run: MailboxRun, folder: Folder): Promise<void> {
  const uidValidity = await run.imap.select(folder.name);
  const states = await select<{ uidvalidity: number; last_uid: number }[]>(`mail_sync?folder=eq.${encodeURIComponent(folder.name)}&select=uidvalidity,last_uid`);
  let lastUid = states.length > 0 && Number(states[0].uidvalidity) === uidValidity ? Number(states[0].last_uid) : 0;
  const uids = await newUids(run.imap, lastUid);
  for (const uid of uids.slice(0, BATCH)) {
    if (!run.hasTime()) break;
    await fetchAndProcess(run, uid, folder);
    lastUid = uid;
  }
  if (uids.length === 0 && lastUid === 0) {
    const all = await run.imap.search("ALL");
    lastUid = all.length > 0 ? all[all.length - 1] : 0;
  }
  await upsert("mail_sync", "folder", { folder: folder.name, uidvalidity: uidValidity, last_uid: lastUid, synced_at: new Date().toISOString(), last_error: "" });
}

async function backfillAddress(run: MailboxRun, folders: Folder[], address: string): Promise<boolean> {
  for (const folder of folders) {
    await run.imap.select(folder.name);
    const uids = await run.imap.search(`OR OR FROM ${quote(address)} TO ${quote(address)} CC ${quote(address)}`);
    for (const uid of uids.slice(-BACKFILL_BATCH)) {
      if (!run.hasTime()) return false;
      await fetchAndProcess(run, uid, folder, address);
    }
  }
  return true;
}

/** Fetches the earlier mails of customers whose address is new or changed. */
export async function backfill(run: MailboxRun, folders: Folder[]): Promise<void> {
  const pending = await select<{ id: string; email: string | null }[]>("customers?select=id,email&mail_backfilled=eq.false&email=not.is.null&limit=10");
  for (const customer of pending) {
    if (!run.hasTime()) return;
    const address = (customer.email ?? "").toLowerCase();
    if (!address.includes("@")) continue;
    run.dir.customers.set(address, customer.id);
    if (!(await backfillAddress(run, folders, address))) return;
    await patch("customers", `id=eq.${customer.id}`, { mail_backfilled: true });
  }
}
