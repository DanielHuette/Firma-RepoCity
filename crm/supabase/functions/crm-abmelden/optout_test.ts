import { assertEquals } from "jsr:@std/assert@1";
import { handleOptOut, PAGE } from "./optout.ts";

const TOKEN = "3f8e2a10-6b7c-4d5e-8f90-a1b2c3d4e5f6";
const URL_WITH_TOKEN = `https://beispiel.supabase.co/functions/v1/crm-abmelden?t=${TOKEN}`;
const URL_WITHOUT_TOKEN = "https://beispiel.supabase.co/functions/v1/crm-abmelden";

class FakeOptOut {
  calls: string[] = [];
  constructor(private readonly known = true, private readonly failure: string | null = null) {}
  optOut = (token: string): Promise<boolean> => {
    this.calls.push(token);
    return this.failure === null ? Promise.resolve(this.known) : Promise.reject(new Error(this.failure));
  };
}

const post = (body: BodyInit | null, headers: Record<string, string> = {}, url = URL_WITH_TOKEN) =>
  new Request(url, { method: "POST", body, headers });
const button = (url = URL_WITH_TOKEN) =>
  post("abmelden=1", { "Content-Type": "application/x-www-form-urlencoded" }, url);
const oneClick = (url = URL_WITH_TOKEN) =>
  post("List-Unsubscribe=One-Click", { "Content-Type": "application/x-www-form-urlencoded" }, url);

Deno.test("the page lives on the CRM site, because supabase.co shows HTML from a GET as plain text", () => {
  assertEquals(PAGE, "https://crm.speedofthespirit.dev/abmelden/");
});

Deno.test("opening the link leads to the page with the button and changes nothing", async () => {
  const fake = new FakeOptOut();
  for (const method of ["GET", "HEAD"]) {
    const response = await handleOptOut(new Request(URL_WITH_TOKEN, { method }), fake.optOut);
    assertEquals([response.status, response.headers.get("Location")], [303, `${PAGE}?t=${TOKEN}`]);
  }
  const broken = await handleOptOut(new Request(`${URL_WITH_TOKEN}0`), fake.optOut);
  assertEquals(broken.headers.get("Location"), `${PAGE}?ergebnis=ungueltig`);
  assertEquals(fake.calls.length, 0);
});

Deno.test("the button opts out and leads to the page that says so", async () => {
  const fake = new FakeOptOut();
  const response = await handleOptOut(button(), fake.optOut);
  assertEquals([response.status, response.headers.get("Location"), fake.calls], [303, `${PAGE}?ergebnis=erledigt`, [TOKEN]]);
});

Deno.test("the button with an unknown, missing or broken token, or a database failure, leads to the matching page", async () => {
  const unknown = await handleOptOut(button(), new FakeOptOut(false).optOut);
  const missing = new FakeOptOut();
  const withoutToken = await handleOptOut(button(URL_WITHOUT_TOKEN), missing.optOut);
  const failed = await handleOptOut(button(), new FakeOptOut(true, "rpc/opt_out: 500 secret").optOut);
  assertEquals(unknown.headers.get("Location"), `${PAGE}?ergebnis=ungueltig`);
  assertEquals(withoutToken.headers.get("Location"), `${PAGE}?ergebnis=ungueltig`);
  assertEquals(failed.headers.get("Location"), `${PAGE}?ergebnis=fehler`);
  assertEquals(missing.calls.length, 0);
});

Deno.test("the one-click request of a mail program opts out without a redirect (RFC 8058 section 3.1)", async () => {
  const urlEncoded = new FakeOptOut();
  const first = await handleOptOut(oneClick(), urlEncoded.optOut);
  const body = new FormData();
  body.set("List-Unsubscribe", "One-Click");
  const multipart = new FakeOptOut();
  const second = await handleOptOut(post(body), multipart.optOut);
  assertEquals([first.status, second.status, first.headers.get("Location")], [200, 200, null]);
  assertEquals([urlEncoded.calls, multipart.calls], [[TOKEN], [TOKEN]]);
  assertEquals(first.headers.get("Content-Type"), "text/plain; charset=utf-8");
});

Deno.test("a one-click request with an unknown token or a database failure gets a status, no detail", async () => {
  const unknown = await handleOptOut(oneClick(), new FakeOptOut(false).optOut);
  const failed = await handleOptOut(oneClick(), new FakeOptOut(true, "secret detail").optOut);
  const unreadable = await handleOptOut(post("%%%", { "Content-Type": "multipart/form-data; boundary=x" }), new FakeOptOut().optOut);
  assertEquals([unknown.status, failed.status, unreadable.status], [404, 503, 200]);
  assertEquals((await failed.text()).includes("secret"), false);
});

Deno.test("answers are never stored and never send the address on", async () => {
  const response = await handleOptOut(button(), new FakeOptOut().optOut);
  for (const [name, value] of [["Cache-Control", "no-store"], ["Referrer-Policy", "no-referrer"],
    ["X-Content-Type-Options", "nosniff"], ["X-Robots-Tag", "noindex"]]) assertEquals(response.headers.get(name), value, name);
});

Deno.test("other methods are refused", async () => {
  const put = await handleOptOut(new Request(URL_WITH_TOKEN, { method: "PUT" }), new FakeOptOut().optOut);
  assertEquals([put.status, put.headers.get("Allow")], [405, "GET, HEAD, POST"]);
});
