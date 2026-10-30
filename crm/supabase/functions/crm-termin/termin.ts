// Booking a proposed hour and asking for another time, from the links in the customer's mails.
// Context: request handling of crm-termin, the database behind AppointmentLinks. Supabase shows HTML
// that a function sends for a GET as plain text unless the project has a paid custom domain, so the
// page with the button is a static page on the CRM site (crm/app/termin/) and this function only
// answers with redirects. Opening a link only reads, because link scanners of mail providers open
// links on their own; booking and the wish for another time need the POST of the button. | Input:
// ?buchen=<crm.audit_offers.token> or ?anders=<crm.audit_requests.reschedule_token>; GET or HEAD
// (the link), POST with the field of the same name (the button). | Output: a redirect to the page
// with the hour to show (?abgelaufen= when its 48 hours of reservation ran out), or with
// ergebnis=gebucht, belegt, abgelaufen, gewuenscht, ungueltig or fehler.
import { linkToken } from "../_shared/token.ts";

/** The page with the button and the result texts. */
export const PAGE = "https://crm.speedofthespirit.dev/termin/";

const KINDS = new Set(["visit", "call", "video"]);

/** The database functions behind the two links; their answers are checked here, not trusted. */
export interface AppointmentLinks {
  offer(token: string): Promise<unknown>;
  book(token: string): Promise<unknown>;
  current(token: string): Promise<unknown>;
  reschedule(token: string): Promise<unknown>;
}

type Query = Record<string, string>;

const HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
};
const INVALID: Query = { ergebnis: "ungueltig" };
const FAILED: Query = { ergebnis: "fehler" };

class UnexpectedAnswer extends Error {}

function redirect(query: Query): Response {
  return new Response(null, { status: 303, headers: { ...HEADERS, Location: `${PAGE}?${new URLSearchParams(query).toString()}` } });
}

function fields(answer: unknown): Record<string, unknown> {
  if (typeof answer !== "object" || answer === null) throw new UnexpectedAnswer("Antwort ohne Felder");
  return answer as Record<string, unknown>;
}

function instant(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new UnexpectedAnswer("Zeit fehlt");
  return value;
}

function kind(value: unknown): string {
  if (typeof value !== "string" || !KINDS.has(value)) throw new UnexpectedAnswer("Gesprächsart fehlt");
  return value;
}

function offerPage(token: string, answer: unknown): Query {
  const view = fields(answer);
  if (view.state === "open") return { buchen: token, zeit: instant(view.starts_at), art: kind(view.kind) };
  if (view.state === "expired") return { abgelaufen: token, zeit: instant(view.starts_at), art: kind(view.kind) };
  if (view.state === "booked") return { ergebnis: "gebucht", zeit: instant(view.starts_at) };
  if (view.state === "invalid") return INVALID;
  throw new UnexpectedAnswer("Unbekannter Stand");
}

function bookedPage(answer: unknown): Query {
  const result = fields(answer);
  if (result.result === "booked") return { ergebnis: "gebucht", zeit: instant(result.starts_at) };
  if (result.result === "taken") return { ergebnis: "belegt" };
  if (result.result === "expired") return { ergebnis: "abgelaufen" };
  if (result.result === "invalid") return INVALID;
  throw new UnexpectedAnswer("Unbekanntes Ergebnis");
}

function currentPage(token: string, answer: unknown): Query {
  const view = fields(answer);
  if (view.state === "open") return { anders: token, zeit: instant(view.starts_at) };
  if (view.state === "requested") return { ergebnis: "gewuenscht", zeit: instant(view.starts_at) };
  if (view.state === "invalid") return INVALID;
  throw new UnexpectedAnswer("Unbekannter Stand");
}

function rescheduledPage(answer: unknown): Query {
  const result = fields(answer).result;
  if (result === "requested" || result === "already") return { ergebnis: "gewuenscht" };
  if (result === "invalid") return INVALID;
  throw new UnexpectedAnswer("Unbekanntes Ergebnis");
}

// Only the button sends its field; an unreadable body counts as no button.
async function buttonField(request: Request): Promise<string | null> {
  try {
    const form = await request.formData();
    return form.has("buchen") ? "buchen" : form.has("anders") ? "anders" : null;
  } catch {
    return null;
  }
}

async function answer(work: () => Promise<Query>): Promise<Response> {
  try {
    return redirect(await work());
  } catch (error) {
    console.error("crm-termin:", error instanceof Error ? error.message : String(error));
    return redirect(FAILED);
  }
}

export async function handleAppointmentLink(request: Request, links: AppointmentLinks): Promise<Response> {
  const { method } = request;
  if (method !== "GET" && method !== "HEAD" && method !== "POST") {
    return new Response(null, { status: 405, headers: { ...HEADERS, Allow: "GET, HEAD, POST" } });
  }
  const offer = linkToken(request.url, "buchen");
  const current = linkToken(request.url, "anders");
  if (method !== "POST") {
    if (offer !== null) return answer(async () => offerPage(offer, await links.offer(offer)));
    if (current !== null) return answer(async () => currentPage(current, await links.current(current)));
    return redirect(INVALID);
  }
  const button = await buttonField(request);
  if (button === "buchen" && offer !== null) return answer(async () => bookedPage(await links.book(offer)));
  if (button === "anders" && current !== null) return answer(async () => rescheduledPage(await links.reschedule(current)));
  return redirect(INVALID);
}
