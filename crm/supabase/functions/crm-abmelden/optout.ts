// Opting out of follow-up mails and review requests.
// Context: request handling of crm-abmelden, the database behind OptOut. Supabase shows HTML that a
// function sends for a GET as plain text unless the project has a paid custom domain, so the page
// with the button is a static page on the CRM site (crm/app/public/abmelden/) and this function
// only answers with redirects or plain text. Opening a link never changes anything, because link
// scanners of mail providers open links on their own. | Input: ?t=<customers.optout_token>; GET or
// HEAD (the link), POST with the field "abmelden" (the button on the page), any other POST (the
// one-click request a mail program sends for the List-Unsubscribe header, RFC 8058). | Output: a
// redirect to the page, or for the one-click request a plain status, never a redirect, because
// RFC 8058 section 3.1 forbids one.
import { linkToken } from "../_shared/token.ts";

/** crm.opt_out: true when the token belonged to a customer. */
export type OptOut = (token: string) => Promise<boolean>;

/** The static page with the button and the result texts. */
export const PAGE = "https://crm.speedofthespirit.dev/abmelden/";

type Outcome = "erledigt" | "ungueltig" | "fehler";

const HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
};

const PLAIN: Record<Outcome, [number, string]> = {
  erledigt: [200, "Erledigt. Sie bekommen keine Erinnerungen und keine Bewertungsbitten mehr."],
  ungueltig: [404, "Dieser Link ist nicht gültig."],
  fehler: [503, "Das hat gerade nicht geklappt."],
};

function redirect(query: string): Response {
  return new Response(null, { status: 303, headers: { ...HEADERS, Location: `${PAGE}?${query}` } });
}

function plain(outcome: Outcome): Response {
  const [status, text] = PLAIN[outcome];
  return new Response(text, { status, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

// Only the button sends the field "abmelden"; an unreadable body counts as a one-click request.
async function fromButton(request: Request): Promise<boolean> {
  try {
    return (await request.formData()).has("abmelden");
  } catch {
    return false;
  }
}

async function optOutOutcome(token: string | null, optOut: OptOut): Promise<Outcome> {
  if (token === null) return "ungueltig";
  try {
    return (await optOut(token)) ? "erledigt" : "ungueltig";
  } catch (error) {
    console.error("crm-abmelden:", error instanceof Error ? error.message : String(error));
    return "fehler";
  }
}

export async function handleOptOut(request: Request, optOut: OptOut): Promise<Response> {
  const { method } = request;
  const token = linkToken(request.url);
  if (method === "GET" || method === "HEAD") return redirect(token === null ? "ergebnis=ungueltig" : `t=${token}`);
  if (method !== "POST") {
    return new Response(null, { status: 405, headers: { ...HEADERS, Allow: "GET, HEAD, POST" } });
  }
  const button = await fromButton(request);
  const outcome = await optOutOutcome(token, optOut);
  return button ? redirect(`ergebnis=${outcome}`) : plain(outcome);
}
