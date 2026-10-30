// Calendar feed of the RepoCity CRM for Daniel's phone: the secret link from the settings shows the
// appointments read-only in any calendar app that subscribes to iCalendar links, without a Google account.
// Context: Supabase Edge Function (Deno), deployed with JWT verification off because calendar apps
// send no token; the secret in the link is the access. | Input: GET ?t=<crm.settings.calendar_token>.
// | Output: text/calendar from crm.calendar_events, 404 for every other link.
import type { FeedRow } from "../_shared/appointment.ts";
import { rpc, select } from "../crm-mail/rest.ts";
import { handleFeed } from "./feed.ts";

Deno.serve((request) => handleFeed(request, {
  events: (token) => rpc<FeedRow[]>("calendar_events", { p_token: token }),
  tokenValid: async (token) => (await select<{ id: number }[]>(`settings?id=eq.1&calendar_token=eq.${token}&select=id`)).length > 0,
}));
