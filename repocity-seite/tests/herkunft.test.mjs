// Unit tests of the channel markers: `node --test tests/herkunft.test.mjs`.
// The same tests live in firma-repocity (repocity-seite/tests/herkunft.test.mjs) and hauptseite
// (site/tests/herkunft.test.mjs); only the import path differs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHANNEL_LABELS,
  applyMarkers,
  channelFrom,
  channelLabel,
  inquirySubject,
  isOwnSite,
  readMarkers,
  withMarkers,
  withSubject,
} from "../site/js/herkunft.js";

// Cases of test_h1_link_markers_become_a_channel in integration/tests/test_scenario_channel.py,
// which runs them against crm.channel_from in crm/supabase/migrations/011_herkunft.sql.
const H1_CASES = [
  ["google", "maps", "google_maps"],
  ["Google", "organic", "google_search"],
  ["linkedin", "social", "linkedin"],
  ["ig", "social", "instagram"],
  ["x", "social", "x"],
  ["newsletter", "email", "newsletter"],
  ["empfehlung", "", "referral"],
  ["irgendwas", "", "other"],
  ["", "", null],
];

// crm.source_channel_label in crm/supabase/migrations/011_herkunft.sql.
const SQL_LABELS = {
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

const BASE = "https://repocity.speedofthespirit.dev/?utm_source=linkedin&utm_medium=social&utm_campaign=test";
const LINKEDIN = { source: "linkedin", medium: "social", campaign: "test" };
const LINKEDIN_QUERY = "utm_source=linkedin&utm_medium=social&utm_campaign=test";

test("the integration cases map like crm.channel_from", () => {
  for (const [source, medium, channel] of H1_CASES) assert.equal(channelFrom(source, medium), channel, `${source}/${medium}`);
});

test("every short name crm.channel_from knows maps to its channel", () => {
  const cases = [
    ["google", "map", "google_maps"], ["google", "gbp", "google_maps"], ["google", "local", "google_maps"],
    ["google", "google_maps", "google_maps"], ["google", "business_profile", "google_maps"], ["google", "MAPS", "google_maps"],
    ["li", "", "linkedin"], ["instagram", "", "instagram"], ["facebook", "", "facebook"], ["fb", "", "facebook"],
    ["xing", "", "xing"], ["youtube", "", "youtube"], ["yt", "", "youtube"], ["tiktok", "", "tiktok"],
    ["twitter", "", "x"], ["threads", "", "threads"], ["reddit", "", "reddit"], ["forum", "", "forum"],
    ["referral", "", "referral"], ["presse", "social", "other"], ["irgendwas", "email", "newsletter"],
    ["linkedin", "email", "linkedin"], [null, null, null], ["", "email", null],
  ];
  for (const [source, medium, channel] of cases) assert.equal(channelFrom(source, medium), channel, `${source}/${medium}`);
});

test("only spaces are trimmed, as btrim does", () => {
  assert.equal(channelFrom("  LinkedIn ", " "), "linkedin");
  assert.equal(channelFrom(" ", ""), null);
  assert.equal(channelFrom("\tlinkedin", ""), "other");
});

test("the labels are those of crm.source_channel_label", () => {
  assert.deepEqual(CHANNEL_LABELS, SQL_LABELS);
  for (const [channel, label] of Object.entries(SQL_LABELS)) assert.equal(channelLabel(channel), label);
  assert.equal(channelLabel(null), "Unbekannt");
  assert.equal(channelLabel("unknown"), "Unbekannt");
});

test("markers are read from the address only when they name a channel", () => {
  assert.deepEqual(readMarkers("?utm_source=linkedin&utm_medium=social&utm_campaign=test"), LINKEDIN);
  assert.deepEqual(readMarkers("?utm_source=google&utm_medium=maps"), { source: "google", medium: "maps", campaign: "" });
  assert.equal(readMarkers(""), null);
  assert.equal(readMarkers("?utm_medium=email&utm_campaign=test"), null);
  assert.equal(readMarkers("?utm_source=+"), null);
});

test("the subject names the label and the campaign as crm.channel_from_subject reads it", () => {
  // Subjects of test_h4_the_contact_mail_names_the_channel_in_its_subject.
  assert.equal(inquirySubject({ source: "linkedin", medium: "social", campaign: "sichtbarkeit-muenster" }), "Anfrage – über LinkedIn (sichtbarkeit-muenster)");
  assert.equal(inquirySubject({ source: "google", medium: "maps", campaign: "" }), "Anfrage – über Google Maps");
  assert.equal(inquirySubject({ source: "irgendwas", medium: "", campaign: "" }), "Anfrage – über Sonstiges");
});

test("a campaign the subject pattern cannot read is left out", () => {
  // The pattern of crm.channel_from_subject: [a-z0-9-]{1,100}, case-insensitive.
  const subject = (campaign) => inquirySubject({ source: "linkedin", medium: "social", campaign });
  assert.equal(subject("a".repeat(100)), `Anfrage – über LinkedIn (${"a".repeat(100)})`);
  assert.equal(subject("Sommer-2026"), "Anfrage – über LinkedIn (Sommer-2026)");
  for (const campaign of ["a".repeat(101), "sommer_2026", "sommer 2026", "(x)", "ä"]) assert.equal(subject(campaign), "Anfrage – über LinkedIn");
});

test("a mail link without subject gets one", () => {
  assert.equal(
    withSubject("mailto:kontakt@speedofthespirit.dev", "Anfrage – über LinkedIn (test)"),
    "mailto:kontakt@speedofthespirit.dev?subject=Anfrage%20%E2%80%93%20%C3%BCber%20LinkedIn%20(test)",
  );
});

test("an existing subject stays in front and other fields stay", () => {
  assert.equal(
    withSubject("MAILTO:kontakt@speedofthespirit.dev?body=Hallo%2BWelt&Subject=Frage+1", "Anfrage – über X"),
    "MAILTO:kontakt@speedofthespirit.dev?body=Hallo%2BWelt&Subject=Frage%2B1%20%E2%80%93%20Anfrage%20%E2%80%93%20%C3%BCber%20X",
  );
  assert.equal(withSubject("mailto:a@b.de?cc=c@d.de", "Anfrage – über X"), "mailto:a@b.de?cc=c@d.de&subject=Anfrage%20%E2%80%93%20%C3%BCber%20X");
  assert.equal(withSubject("mailto:a@b.de?", "Anfrage – über X"), "mailto:a@b.de?subject=Anfrage%20%E2%80%93%20%C3%BCber%20X");
  assert.equal(withSubject("mailto:a@b.de?subject=", "Anfrage – über X"), "mailto:a@b.de?subject=Anfrage%20%E2%80%93%20%C3%BCber%20X");
});

test("a mail link is changed once and a broken one not at all", () => {
  const once = withSubject("mailto:a@b.de?subject=Frage", "Anfrage – über X");
  assert.equal(withSubject(once, "Anfrage – über X"), once);
  assert.equal(withSubject("mailto:a@b.de?subject=%E0%A4%A", "Anfrage – über X"), "mailto:a@b.de?subject=%E0%A4%A");
});

test("own sites are speedofthespirit.dev and its subdomains over https", () => {
  for (const url of ["https://speedofthespirit.dev/", "https://radarauditor.speedofthespirit.dev/blog/", "https://RepoCity.SpeedOfTheSpirit.dev"]) assert.ok(isOwnSite(url), url);
  for (const url of [
    "http://speedofthespirit.dev/", "https://evilspeedofthespirit.dev/", "https://speedofthespirit.dev.example.com/",
    "https://speedofthespirit.dev@example.com/", "https://www.linkedin.com/in/danielhuette", "mailto:kontakt@speedofthespirit.dev", "nicht eine Adresse",
  ]) assert.ok(!isOwnSite(url), url);
});

test("links to own sites get the markers, with their query and fragment kept", () => {
  assert.equal(withMarkers("https://speedofthespirit.dev/", LINKEDIN, BASE), `https://speedofthespirit.dev/?${LINKEDIN_QUERY}`);
  assert.equal(withMarkers("https://speedofthespirit.dev/de/#repocity", LINKEDIN, BASE), `https://speedofthespirit.dev/de/?${LINKEDIN_QUERY}#repocity`);
  assert.equal(
    withMarkers("https://agenticmarketing.speedofthespirit.dev/?lang=en#benchmarks", LINKEDIN, BASE),
    `https://agenticmarketing.speedofthespirit.dev/?lang=en&${LINKEDIN_QUERY}#benchmarks`,
  );
  assert.equal(withMarkers("https://speedofthespirit.dev/?", LINKEDIN, BASE), `https://speedofthespirit.dev/?${LINKEDIN_QUERY}`);
  assert.equal(withMarkers("/en/", LINKEDIN, BASE), `/en/?${LINKEDIN_QUERY}`);
});

test("only the markers the visitor brought are handed on", () => {
  assert.equal(withMarkers("/de/", { source: "google", medium: "maps", campaign: "" }, BASE), "/de/?utm_source=google&utm_medium=maps");
  assert.equal(withMarkers("/de/", { source: "Mein Kanal", medium: "", campaign: "a&b" }, BASE), "/de/?utm_source=Mein+Kanal&utm_campaign=a%26b");
});

test("anchors, marked, foreign and broken links stay as they are", () => {
  for (const href of [
    "#crm", "https://speedofthespirit.dev/?utm_source=google&utm_medium=maps", "https://speedofthespirit.dev/?a=1&UTM_TERM=x",
    "https://www.linkedin.com/in/danielhuette", "http://speedofthespirit.dev/", "https://github.com/DanielHuette", "tel:+492511234567",
    "https://[::1/",
  ]) assert.equal(withMarkers(href, LINKEDIN, BASE), href, href);
});

function fakeDocument(hrefs) {
  const links = hrefs.map((href) => ({
    href,
    getAttribute(name) { return name === "href" ? this.href : null; },
    setAttribute(name, value) { if (name === "href") this.href = value; },
  }));
  return { links, querySelectorAll: (selector) => (selector === "a[href]" ? links : []) };
}

test("the page wrapper marks mail links and links to own sites", () => {
  const page = fakeDocument(["mailto:kontakt@speedofthespirit.dev", "https://speedofthespirit.dev/de/", "#crm", "https://github.com/DanielHuette"]);
  applyMarkers(page, { search: "?utm_source=linkedin&utm_medium=social&utm_campaign=test", href: BASE });
  assert.deepEqual(page.links.map((link) => link.href), [
    "mailto:kontakt@speedofthespirit.dev?subject=Anfrage%20%E2%80%93%20%C3%BCber%20LinkedIn%20(test)",
    `https://speedofthespirit.dev/de/?${LINKEDIN_QUERY}`,
    "#crm",
    "https://github.com/DanielHuette",
  ]);
});

test("without utm_source the page wrapper changes nothing", () => {
  const hrefs = ["mailto:kontakt@speedofthespirit.dev", "https://speedofthespirit.dev/de/"];
  for (const search of ["", "?utm_medium=social&utm_campaign=test", "?lang=en"]) {
    const page = fakeDocument(hrefs);
    applyMarkers(page, { search, href: `https://speedofthespirit.dev/${search}` });
    assert.deepEqual(page.links.map((link) => link.href), hrefs);
  }
});
