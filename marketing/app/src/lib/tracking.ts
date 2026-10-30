// Campaign markers on links to the company's own sites, for the text Daniel copies to post.
// Context: the same rules as src/agentic_marketing/tracking.py (a campaign push marks there); the
// CRM reads utm_source and utm_medium with crm.channel_from (crm/supabase/migrations/011_herkunft.sql)
// and every channel value is also the utm_source it reads as that channel. | Input: the text of a
// post, its channel, the campaign slug and the post slug. | Output: the text with marked links.
import type { Channel } from "../api/types";

export interface Markers {
  source: string;
  medium: string;
  /** Empty when the slug is longer than the CRM keeps (100 characters); then it is left out. */
  campaign: string;
  content: string;
}

const OWN_DOMAIN = "speedofthespirit.dev";
const CAMPAIGN = /^[a-z0-9-]{1,100}$/;
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;
// Quotation marks and the ellipsis end the sentence, not the link.
const TRAILING = ".,;:!?*“”‘’«»…";
const CLOSING: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/** The markers of a post; null for a blog post, a page of an own site, which keeps the visitor's markers. */
export function markersFor(channel: Channel, campaign: string, post: string): Markers | null {
  if (channel === "blog") return null;
  return {
    source: channel,
    medium: channel === "newsletter" ? "email" : "social",
    campaign: CAMPAIGN.test(campaign) ? campaign : "",
    content: post,
  };
}

export function isOwnSite(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return parsed.protocol === "https:" && parsed.username === "" && (host === OWN_DOMAIN || host.endsWith(`.${OWN_DOMAIN}`));
}

function markerQuery(markers: Markers): string {
  const pairs: [string, string][] = [["utm_source", markers.source], ["utm_medium", markers.medium]];
  if (markers.campaign !== "") pairs.push(["utm_campaign", markers.campaign]);
  pairs.push(["utm_content", markers.content]);
  return new URLSearchParams(pairs).toString();
}

/** Appends the markers to a link to an own site without utm parameters; anything else stays as written. */
export function markUrl(url: string, markers: Markers): string {
  if (!isOwnSite(url)) return url;
  const hashAt = url.indexOf("#");
  const address = hashAt === -1 ? url : url.slice(0, hashAt);
  const fragment = hashAt === -1 ? "" : url.slice(hashAt);
  const queryAt = address.indexOf("?");
  const query = queryAt === -1 ? "" : address.slice(queryAt + 1);
  if ([...new URLSearchParams(query).keys()].some((name) => name.toLowerCase().startsWith("utm_"))) return url;
  const joiner = query !== "" ? "&" : address.endsWith("?") ? "" : "?";
  return `${address}${joiner}${markerQuery(markers)}${fragment}`;
}

function splitTrailing(candidate: string): [string, string] {
  let end = candidate.length;
  const count = (char: string) => candidate.slice(0, end).split(char).length - 1;
  while (end > 0) {
    const last = candidate.charAt(end - 1);
    const opening = CLOSING[last];
    if (TRAILING.includes(last) || (opening !== undefined && count(opening) < count(last))) {
      end -= 1;
      continue;
    }
    break;
  }
  return [candidate.slice(0, end), candidate.slice(end)];
}

/** Marks every link to an own site in a plain or Markdown text; running it twice changes nothing more. */
export function markLinks(text: string, markers: Markers | null): string {
  if (markers === null) return text;
  return text.replace(URL_PATTERN, (match) => {
    const [link, rest] = splitTrailing(match);
    return markUrl(link, markers) + rest;
  });
}
