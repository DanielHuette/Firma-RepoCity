import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import type { FeedRow } from "../_shared/appointment.ts";
import { type FeedSource, handleFeed } from "./feed.ts";

const TOKEN = "0b6f2c3e-8a41-4d8e-9f0a-5c2d7e1b3a94";
const BASE = "https://beispiel.supabase.co/functions/v1/crm-calendar";

const appointment: FeedRow = {
  id: "7d5c1c1e-4f0a-4a51-9a52-3f1d2a7b9c10", kind: "callback", title: "Rückruf Erika Beispiel", starts_on: "2026-10-31", starts_at: null,
  ends_at: null, location: "", note: "Rufnummer 0251 000000", updated_at: "2026-10-30T08:00:00+00:00", customer_name: null, status: "planned",
};

class FakeSource implements FeedSource {
  asked: string[] = [];
  constructor(private readonly rows: FeedRow[], private readonly known = true, private readonly failure: string | null = null) {}
  events(token: string) {
    this.asked.push(token);
    return this.failure === null ? Promise.resolve(this.known ? this.rows : []) : Promise.reject(new Error(this.failure));
  }
  tokenValid() { return Promise.resolve(this.known); }
}

const get = (query: string, method = "GET") => new Request(`${BASE}${query}`, { method });

Deno.test("the right token gets the feed as private, uncached iCalendar", async () => {
  const source = new FakeSource([appointment]);
  const response = await handleFeed(get(`?t=${TOKEN}`), source);
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "text/calendar; charset=utf-8");
  assertEquals(response.headers.get("Cache-Control"), "private, no-store");
  assertEquals(response.headers.get("Referrer-Policy"), "no-referrer");
  assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
  const body = await response.text();
  assertStringIncludes(body, "\r\nDTSTART;VALUE=DATE:20261031\r\n");
  assertStringIncludes(body, "\r\nSUMMARY:Rückruf Erika Beispiel\r\n");
  assertEquals(source.asked, [TOKEN]);
});

Deno.test("a missing, malformed or wrong token is answered with 404 and nothing else", async () => {
  for (const query of ["", "?t=", "?t=abc", `?t=${TOKEN}x`, "?x=1"]) {
    const source = new FakeSource([appointment]);
    const response = await handleFeed(get(query), source);
    assertEquals([response.status, await response.text(), source.asked.length], [404, "Nicht gefunden.", 0], query);
  }
  const wrong = await handleFeed(get(`?t=${TOKEN}`), new FakeSource([appointment], false));
  assertEquals([wrong.status, await wrong.text()], [404, "Nicht gefunden."]);
});

Deno.test("the right token without appointments gets an empty calendar", async () => {
  const response = await handleFeed(get(`?t=${TOKEN.toUpperCase()}`), new FakeSource([]));
  assertEquals(response.status, 200);
  const body = await response.text();
  assert(body.startsWith("BEGIN:VCALENDAR\r\n") && !body.includes("BEGIN:VEVENT"));
});

Deno.test("only reading is allowed, a HEAD request gets the headers alone", async () => {
  const post = await handleFeed(get(`?t=${TOKEN}`, "POST"), new FakeSource([appointment]));
  assertEquals([post.status, post.headers.get("Allow")], [405, "GET, HEAD"]);
  const head = await handleFeed(get(`?t=${TOKEN}`, "HEAD"), new FakeSource([appointment]));
  assertEquals([head.status, head.headers.get("Content-Type"), await head.text()], [200, "text/calendar; charset=utf-8", ""]);
});

Deno.test("a database failure gives 503 without its detail", async () => {
  const response = await handleFeed(get(`?t=${TOKEN}`), new FakeSource([], true, "Datenbank rpc/calendar_events: 500 secret detail"));
  assertEquals([response.status, await response.text()], [503, "Der Kalender ist gerade nicht erreichbar."]);
});
