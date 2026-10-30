// Where a visitor came from, carried through the visit without storing anything on the device.
// Context: links of the marketing app carry utm_source, utm_medium and utm_campaign. The CRM reads
// the channel from them (crm.channel_from in crm/supabase/migrations/011_herkunft.sql) and, for a
// contact mail, from its subject "Anfrage – über <label> (<campaign>)" (crm.channel_from_subject).
// No cookie and no browser storage: either would need consent under section 25 of the German
// Telecommunications Digital Services Data Protection Act (TDDDG). The markers are read from the
// address on every page and handed on through the links instead. | Input: location and the links
// of the page. | Output: mail links with that subject, links to own sites with the markers.
//
// The same file lives in two repositories, firma-repocity (repocity-seite/site/js/herkunft.js) and
// hauptseite (site/quellen/js/herkunft.js). Each keeps its own copy because they are deployed
// separately; a change to one belongs in the other.

export const OWN_DOMAIN = "speedofthespirit.dev";

// crm.source_channel_label; null and every other value read "Unbekannt".
export const CHANNEL_LABELS = {
  google_search: "Google-Suche",
  google_maps: "Google Maps",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  xing: "Xing",
  youtube: "YouTube",
  tiktok: "TikTok",
  x: "X",
  threads: "Threads",
  reddit: "Reddit",
  forum: "Forum",
  newsletter: "Newsletter",
  referral: "Empfehlung",
  other: "Sonstiges",
};
const UNKNOWN_LABEL = "Unbekannt";

const MAP_MEDIUMS = ["maps", "map", "gbp", "local", "google_maps", "business_profile"];
const SOURCES = {
  linkedin: "linkedin", li: "linkedin", instagram: "instagram", ig: "instagram", facebook: "facebook", fb: "facebook",
  xing: "xing", youtube: "youtube", yt: "youtube", tiktok: "tiktok", x: "x", twitter: "x", threads: "threads",
  reddit: "reddit", forum: "forum",
};
// The campaign pattern of crm.channel_from_subject, which matches case-insensitively.
const CAMPAIGN = /^[a-z0-9-]{1,100}$/i;
const SUBJECT_PREFIX = "Anfrage – über ";
const JOINER = " – ";
const MARKER_PREFIX = "utm_";

// lower(btrim(coalesce(value, ''))): btrim without a second argument removes spaces only.
function normalise(value) {
  return String(value ?? "").replace(/^ +| +$/g, "").toLowerCase();
}

/** The channel crm.channel_from gives for utm_source and utm_medium; null without a source. */
export function channelFrom(source, medium) {
  const from = normalise(source);
  const by = normalise(medium);
  if (from === "") return null;
  if (from === "google") return MAP_MEDIUMS.includes(by) ? "google_maps" : "google_search";
  if (Object.hasOwn(SOURCES, from)) return SOURCES[from];
  if (from === "newsletter" || by === "email") return "newsletter";
  if (from === "empfehlung" || from === "referral") return "referral";
  return "other";
}

/** The German word crm.source_channel_label shows for a channel. */
export function channelLabel(channel) {
  return Object.hasOwn(CHANNEL_LABELS, channel ?? "") ? CHANNEL_LABELS[channel] : UNKNOWN_LABEL;
}

/** utm_source, utm_medium and utm_campaign of an address query; null when they name no channel. */
export function readMarkers(search) {
  const query = new URLSearchParams(search);
  const markers = { source: query.get("utm_source") ?? "", medium: query.get("utm_medium") ?? "", campaign: query.get("utm_campaign") ?? "" };
  return channelFrom(markers.source, markers.medium) === null ? null : markers;
}

/** "Anfrage – über <label> (<campaign>)"; a campaign the CRM cannot read back is left out. */
export function inquirySubject(markers) {
  const label = channelLabel(channelFrom(markers.source, markers.medium));
  return SUBJECT_PREFIX + label + (CAMPAIGN.test(markers.campaign) ? ` (${markers.campaign})` : "");
}

/** A mailto: address with the subject added; an existing subject stays in front of it. */
export function withSubject(href, subject) {
  const mark = href.indexOf("?");
  const address = mark === -1 ? href : href.slice(0, mark);
  const fields = mark === -1 ? [] : href.slice(mark + 1).split("&").filter((field) => field !== "");
  const index = fields.findIndex((field) => field.split("=", 1)[0].toLowerCase() === "subject");
  const encoded = (text) => encodeURIComponent(text);
  if (index === -1) return `${address}?${[...fields, `subject=${encoded(subject)}`].join("&")}`;
  const [name, ...rest] = fields[index].split("=");
  let existing;
  try {
    existing = decodeURIComponent(rest.join("="));
  } catch {
    return href;
  }
  if (existing.endsWith(subject)) return href;
  fields[index] = `${name}=${encoded(existing.trim() === "" ? subject : existing + JOINER + subject)}`;
  return `${address}?${fields.join("&")}`;
}

/** Whether an address is an https page of speedofthespirit.dev or one of its subdomains. */
export function isOwnSite(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && (parsed.hostname === OWN_DOMAIN || parsed.hostname.endsWith(`.${OWN_DOMAIN}`));
}

// An in-page anchor resolves to the current address, which carries the markers already.
/** A link with the visitor's markers appended, when it leads to an own site and carries none. */
export function withMarkers(href, markers, base) {
  let target;
  try {
    target = new URL(href, base);
  } catch {
    return href;
  }
  if (!isOwnSite(target.href)) return href;
  if ([...target.searchParams.keys()].some((name) => name.toLowerCase().startsWith(MARKER_PREFIX))) return href;
  const query = new URLSearchParams();
  for (const [name, value] of [["utm_source", markers.source], ["utm_medium", markers.medium], ["utm_campaign", markers.campaign]]) {
    if (value !== "") query.append(name, value);
  }
  const hash = href.indexOf("#");
  const address = hash === -1 ? href : href.slice(0, hash);
  const fragment = hash === -1 ? "" : href.slice(hash);
  const joiner = address.endsWith("?") ? "" : address.includes("?") ? "&" : "?";
  return `${address}${joiner}${query}${fragment}`;
}

/** Rewrite the links of a page for the markers in its address; without utm_source nothing changes. */
export function applyMarkers(page, place) {
  const markers = readMarkers(place.search);
  if (markers === null) return;
  const subject = inquirySubject(markers);
  for (const link of page.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href");
    const changed = /^mailto:/i.test(href) ? withSubject(href, subject) : withMarkers(href, markers, place.href);
    if (changed !== href) link.setAttribute("href", changed);
  }
}

if (typeof document !== "undefined") applyMarkers(document, location);
