// Opt-out link of the follow-up mails ("Keine Erinnerungen mehr"): the customer's click, or the
// mail program's one-click request for the List-Unsubscribe header, stops reminders and review
// requests through crm.opt_out.
// Context: Supabase Edge Function (Deno), deployed with JWT verification off because customers and
// mail programs send no token; the secret in the link is the access. | Input: GET or POST
// ?t=<crm.customers.optout_token>. | Output: a redirect to the page on the CRM site, or plain text
// for the one-click request of a mail program (see optout.ts).
import { rpc } from "../crm-mail/rest.ts";
import { handleOptOut } from "./optout.ts";

Deno.serve((request) => handleOptOut(request, (token) => rpc<boolean>("opt_out", { p_token: token })));
