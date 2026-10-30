// The appointment links of the customer's mails: a proposed hour from "Anderen Termin vorschlagen" is
// booked with one click on the page, and "Anderen Termin wünschen" in a confirmation asks Daniel.
// Context: Supabase Edge Function (Deno), deployed with JWT verification off because customers send
// no token; the secret in the link is the access. | Input: GET or POST ?buchen=<token> or
// ?anders=<token>. | Output: a redirect to the page on the CRM site (see termin.ts).
import { rpc } from "../crm-mail/rest.ts";
import { handleAppointmentLink } from "./termin.ts";

Deno.serve((request) => handleAppointmentLink(request, {
  offer: (token) => rpc("audit_offer_view", { p_token: token }),
  book: (token) => rpc("book_audit_offer", { p_token: token }),
  current: (token) => rpc("audit_reschedule_view", { p_token: token }),
  reschedule: (token) => rpc("request_audit_reschedule", { p_token: token }),
}));
