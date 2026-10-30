// Fixed settings of the mail worker: mail servers, batch sizes and the time budget of one run.

// Zoho accounts on an own domain use the "pro" servers (Zoho Mail settings, IMAP tab).
export const IMAP_HOST = "imappro.zoho.eu";
export const SMTP_HOST = "smtppro.zoho.eu";
export const BATCH = 25;
export const BACKFILL_BATCH = 60;
export const INITIAL_DAYS = 14;
export const WALL_BUDGET_MS = 110_000;
export const MAX_MAIL_BYTES = 25 * 1024 * 1024;
export const BODY_LIMIT = 20_000;
export const TRIAGE_TEXT_LIMIT = 8000;
export const QUOTE_PDF_WAIT_MS = 30 * 60_000;
export const INVOICE_PDFS_PER_RUN = 10;
// Authserv-ids Zoho writes into Authentication-Results: "mx.zohomail.eu" in Daniel's EU mailbox,
// "mx.zohomail.com" (help.zoho.com, topic "Email SPF Hard Fail", 2025) and the older "mx.zoho.com"
// (topic "Authentication-results Header format incorrect").
export const ZOHO_AUTHSERV_IDS: readonly string[] = ["mx.zohomail.eu", "mx.zohomail.com", "mx.zoho.com"];
