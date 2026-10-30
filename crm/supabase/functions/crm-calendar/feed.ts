// The answer of the calendar feed: the appointments as iCalendar for the token of the settings,
// 404 for any other request, so a guessed link learns nothing.
// Context: request handling of crm-calendar, the database behind FeedSource. | Input: GET ?t=<token>.
// | Output: text/calendar or a short plain text answer.
import { type FeedRow, feedCalendar } from "../_shared/appointment.ts";
import { linkToken } from "../_shared/token.ts";

export interface FeedSource {
  /** Rows of crm.calendar_events; none for a wrong token. */
  events(token: string): Promise<FeedRow[]>;
  /** Whether the token is crm.settings.calendar_token. */
  tokenValid(token: string): Promise<boolean>;
}

const PRIVATE = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

function text(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...PRIVATE, "Content-Type": "text/plain; charset=utf-8", ...extra } });
}

async function feed(source: FeedSource, token: string): Promise<string | null> {
  const rows = await source.events(token);
  // Only an empty answer can hide a wrong token: rows come back for the right one alone.
  if (rows.length === 0 && !(await source.tokenValid(token))) return null;
  return feedCalendar(rows);
}

export async function handleFeed(request: Request, source: FeedSource): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return text(405, "Nur Lesen.", { Allow: "GET, HEAD" });
  const token = linkToken(request.url);
  if (token === null) return text(404, "Nicht gefunden.");
  let calendar: string | null;
  try {
    calendar = await feed(source, token);
  } catch (error) {
    console.error("crm-calendar:", error instanceof Error ? error.message : String(error));
    return text(503, "Der Kalender ist gerade nicht erreichbar.");
  }
  if (calendar === null) return text(404, "Nicht gefunden.");
  const headers = { ...PRIVATE, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="termine.ics"' };
  return new Response(request.method === "HEAD" ? null : calendar, { status: 200, headers });
}
