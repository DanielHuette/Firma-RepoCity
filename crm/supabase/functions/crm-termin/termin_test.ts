import { assertEquals } from "jsr:@std/assert@1";
import { type AppointmentLinks, handleAppointmentLink, PAGE } from "./termin.ts";

const TOKEN = "3f8e2a10-6b7c-4d5e-8f90-a1b2c3d4e5f6";
const FUNCTION = "https://beispiel.supabase.co/functions/v1/crm-termin";
const STARTS = "2026-11-03T09:00:00+00:00";

class FakeLinks implements AppointmentLinks {
  calls: string[] = [];
  constructor(private readonly answers: Partial<Record<keyof AppointmentLinks, unknown>> = {}, private readonly failure = false) {}
  private answer<T>(name: keyof AppointmentLinks, token: string, fallback: T): Promise<T> {
    this.calls.push(`${name} ${token}`);
    if (this.failure) return Promise.reject(new Error("rpc: 500 geheim"));
    return Promise.resolve((this.answers[name] ?? fallback) as T);
  }
  offer = (token: string) => this.answer("offer", token, { state: "open", starts_at: STARTS, kind: "video" });
  book = (token: string) => this.answer("book", token, { result: "booked", starts_at: STARTS });
  current = (token: string) => this.answer("current", token, { state: "open", starts_at: STARTS });
  reschedule = (token: string) => this.answer("reschedule", token, { result: "requested" });
}

const form = (field: string, query: string) =>
  new Request(`${FUNCTION}?${query}`, { method: "POST", body: `${field}=1`, headers: { "Content-Type": "application/x-www-form-urlencoded" } });

function location(response: Response): URLSearchParams {
  const target = response.headers.get("Location") ?? "";
  assertEquals(target.startsWith(`${PAGE}?`), true, target);
  return new URL(target).searchParams;
}

Deno.test("the page lives on the CRM site, because supabase.co shows HTML from a GET as plain text", () => {
  assertEquals(PAGE, "https://crm.speedofthespirit.dev/termin/");
});

Deno.test("opening a proposal link shows the hour on the page and books nothing", async () => {
  for (const method of ["GET", "HEAD"]) {
    const fake = new FakeLinks();
    const response = await handleAppointmentLink(new Request(`${FUNCTION}?buchen=${TOKEN.toUpperCase()}`, { method }), fake);
    assertEquals(response.status, 303);
    assertEquals(Object.fromEntries(location(response)), { buchen: TOKEN, zeit: STARTS, art: "video" });
    assertEquals(fake.calls, [`offer ${TOKEN}`]);
  }
});

Deno.test("a booked, unknown or broken proposal link leads to the matching result", async () => {
  const booked = await handleAppointmentLink(new Request(`${FUNCTION}?buchen=${TOKEN}`),
    new FakeLinks({ offer: { state: "booked", starts_at: STARTS, kind: "call" } }));
  const unknown = await handleAppointmentLink(new Request(`${FUNCTION}?buchen=${TOKEN}`), new FakeLinks({ offer: { state: "invalid" } }));
  const broken = new FakeLinks();
  const brokenResponse = await handleAppointmentLink(new Request(`${FUNCTION}?buchen=${TOKEN}0`), broken);
  const nothing = await handleAppointmentLink(new Request(FUNCTION), new FakeLinks());
  const failed = await handleAppointmentLink(new Request(`${FUNCTION}?buchen=${TOKEN}`), new FakeLinks({}, true));
  assertEquals(Object.fromEntries(location(booked)), { ergebnis: "gebucht", zeit: STARTS });
  assertEquals(Object.fromEntries(location(unknown)), { ergebnis: "ungueltig" });
  assertEquals(Object.fromEntries(location(brokenResponse)), { ergebnis: "ungueltig" });
  assertEquals(broken.calls, []);
  assertEquals(Object.fromEntries(location(nothing)), { ergebnis: "ungueltig" });
  assertEquals(Object.fromEntries(location(failed)), { ergebnis: "fehler" });
});

Deno.test("a proposal whose 48 hours of reservation ran out shows the hour with a button for new proposals", async () => {
  const fake = new FakeLinks({ offer: { state: "expired", starts_at: STARTS, kind: "call" } });
  const response = await handleAppointmentLink(new Request(`${FUNCTION}?buchen=${TOKEN}`), fake);
  assertEquals(Object.fromEntries(location(response)), { abgelaufen: TOKEN, zeit: STARTS, art: "call" });
  assertEquals(fake.calls, [`offer ${TOKEN}`]);
});

Deno.test("the button on an expired proposal books nothing and says new proposals follow", async () => {
  const fake = new FakeLinks({ book: { result: "expired" } });
  const response = await handleAppointmentLink(form("buchen", `buchen=${TOKEN}`), fake);
  assertEquals(Object.fromEntries(location(response)), { ergebnis: "abgelaufen" });
  assertEquals(fake.calls, [`book ${TOKEN}`]);
});

Deno.test("an answer of the database outside the agreed shape counts as a failure", async () => {
  const strange = await handleAppointmentLink(new Request(`${FUNCTION}?buchen=${TOKEN}`),
    new FakeLinks({ offer: { state: "open", starts_at: "morgen", kind: "video" } }));
  const wrongKind = await handleAppointmentLink(new Request(`${FUNCTION}?buchen=${TOKEN}`),
    new FakeLinks({ offer: { state: "open", starts_at: STARTS, kind: "<b>" } }));
  assertEquals(Object.fromEntries(location(strange)), { ergebnis: "fehler" });
  assertEquals(Object.fromEntries(location(wrongKind)), { ergebnis: "fehler" });
});

Deno.test("the button books the hour by POST and says so", async () => {
  const fake = new FakeLinks();
  const response = await handleAppointmentLink(form("buchen", `buchen=${TOKEN}`), fake);
  assertEquals(Object.fromEntries(location(response)), { ergebnis: "gebucht", zeit: STARTS });
  assertEquals(fake.calls, [`book ${TOKEN}`]);
});

Deno.test("an hour taken meanwhile, an old link or a failure leads to the matching result", async () => {
  const taken = await handleAppointmentLink(form("buchen", `buchen=${TOKEN}`), new FakeLinks({ book: { result: "taken" } }));
  const old = await handleAppointmentLink(form("buchen", `buchen=${TOKEN}`), new FakeLinks({ book: { result: "invalid" } }));
  const failed = await handleAppointmentLink(form("buchen", `buchen=${TOKEN}`), new FakeLinks({}, true));
  assertEquals(Object.fromEntries(location(taken)), { ergebnis: "belegt" });
  assertEquals(Object.fromEntries(location(old)), { ergebnis: "ungueltig" });
  assertEquals(Object.fromEntries(location(failed)), { ergebnis: "fehler" });
});

Deno.test("a POST without the field of the button books nothing", async () => {
  const fake = new FakeLinks();
  const empty = await handleAppointmentLink(form("andere", `buchen=${TOKEN}`), fake);
  const crossed = await handleAppointmentLink(form("anders", `buchen=${TOKEN}`), fake);
  assertEquals(Object.fromEntries(location(empty)), { ergebnis: "ungueltig" });
  assertEquals(Object.fromEntries(location(crossed)), { ergebnis: "ungueltig" });
  assertEquals(fake.calls, []);
});

Deno.test("the link for another time shows the current appointment and changes nothing", async () => {
  const fake = new FakeLinks();
  const response = await handleAppointmentLink(new Request(`${FUNCTION}?anders=${TOKEN}`), fake);
  const asked = await handleAppointmentLink(new Request(`${FUNCTION}?anders=${TOKEN}`),
    new FakeLinks({ current: { state: "requested", starts_at: STARTS } }));
  const gone = await handleAppointmentLink(new Request(`${FUNCTION}?anders=${TOKEN}`), new FakeLinks({ current: { state: "invalid" } }));
  assertEquals(Object.fromEntries(location(response)), { anders: TOKEN, zeit: STARTS });
  assertEquals(fake.calls, [`current ${TOKEN}`]);
  assertEquals(Object.fromEntries(location(asked)), { ergebnis: "gewuenscht", zeit: STARTS });
  assertEquals(Object.fromEntries(location(gone)), { ergebnis: "ungueltig" });
});

Deno.test("the button for another time asks Daniel by POST, a second time says the same", async () => {
  for (const result of ["requested", "already"]) {
    const fake = new FakeLinks({ reschedule: { result } });
    const response = await handleAppointmentLink(form("anders", `anders=${TOKEN}`), fake);
    assertEquals(Object.fromEntries(location(response)), { ergebnis: "gewuenscht" });
    assertEquals(fake.calls, [`reschedule ${TOKEN}`]);
  }
  const invalid = await handleAppointmentLink(form("anders", `anders=${TOKEN}`), new FakeLinks({ reschedule: { result: "invalid" } }));
  assertEquals(Object.fromEntries(location(invalid)), { ergebnis: "ungueltig" });
});

Deno.test("other methods are refused, every answer keeps the link out of other sites and caches", async () => {
  const refused = await handleAppointmentLink(new Request(`${FUNCTION}?buchen=${TOKEN}`, { method: "PUT" }), new FakeLinks());
  const redirect = await handleAppointmentLink(new Request(`${FUNCTION}?buchen=${TOKEN}`), new FakeLinks());
  assertEquals([refused.status, refused.headers.get("Allow")], [405, "GET, HEAD, POST"]);
  for (const response of [refused, redirect]) {
    assertEquals(response.headers.get("Cache-Control"), "no-store");
    assertEquals(response.headers.get("Referrer-Policy"), "no-referrer");
    assertEquals(response.headers.get("X-Robots-Tag"), "noindex");
  }
});
