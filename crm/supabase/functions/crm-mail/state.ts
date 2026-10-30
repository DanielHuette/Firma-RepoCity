// What one run of the worker knows about addresses, and what it reports back to the app.

export interface Review { id: string; mail_count: number; status: string }

export interface Directory {
  ownDomain: string;
  /** Lower-case address to customer id. */
  customers: Map<string, string>;
  ignored: Set<string>;
  reviews: Map<string, Review>;
  /** Address to the id of its unknown-sender triage row that is not applied yet. */
  triage: Map<string, string>;
  /** Customer id to the earliest send time (milliseconds) of the quotes still waiting for an answer. */
  quoteSince: Map<string, number>;
  /** Folder names by direction, for mails filed from the triage store. */
  folders: { in: string; out: string };
}

export interface Report {
  imported: number;
  /** New customers taken in from classified senders. */
  created: number;
  /** New unknown senders of this run: queued for classification or parked as automatic. */
  parked: number;
  /** Of those, the ones queued for the server worker. */
  queued: number;
  /** Invoice PDFs rendered for invoices that had none. */
  documents: number;
  sent: number;
  failed: number;
  errors: string[];
}

export function newReport(): Report {
  return { imported: 0, created: 0, parked: 0, queued: 0, sent: 0, failed: 0, documents: 0, errors: [] };
}

export function emptyDirectory(ownDomain: string): Directory {
  return { ownDomain, customers: new Map(), ignored: new Set(), reviews: new Map(), triage: new Map(), quoteSince: new Map(), folders: { in: "INBOX", out: "INBOX" } };
}
