// Unit tests of the request handler behind /api/termine and /api/anfrage: `node --test tests/*.test.mjs`.
// The database is a stand-in for PostgREST that records each call and answers as told.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../server/anfrage.mjs";

const ENV = { SUPABASE_URL: "https://projekt.supabase.co/", SUPABASE_ANON_KEY: "oeffentlich" };
const SITE = "https://repocity.speedofthespirit.dev";
const VALID = {
  company: "Dachdeckerei Muster",
  contact: "Erika Muster",
  email: "erika@dachdeckerei-muster.de",
  phone: "0251 123456",
  website: "dachdeckerei-muster.de",
  kind: "visit",
  address: "Musterweg 1, 48143 Münster",
  starts_at: "2026-11-03T08:00:00.000Z",
  message: "Bitte vormittags.",
  utm_source: "linkedin",
  utm_campaign: "herbst",
  request_key: "0b6f4c1e-8d2a-4f7b-9c3e-5a1d2e3f4b6c",
};

let calls;
let answers;
let logged;
const realFetch = globalThis.fetch;
const realError = console.error;

function answer(status, body) {
  return () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  calls = [];
  answers = [];
  logged = [];
  console.error = (line) => logged.push(String(line));
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    const next = answers.shift();
    if (next === undefined) throw new Error("unexpected database call");
    return next();
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
});

function post(body, headers = { "Content-Type": "application/json" }) {
  return new Request(`${SITE}/api/anfrage`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

async function read(response) {
  return { status: response.status, body: await response.json() };
}

test("free slots are read through crm.audit_slots for the chosen kind", async () => {
  answers.push(answer(200, [{ starts_at: "2026-11-03T10:00:00+01:00" }, { starts_at: "2026-11-03T08:00:00+00:00" }]));
  const response = await handleRequest(new Request(`${SITE}/api/termine?art=video`), ENV);
  assert.deepEqual(await read(response), { status: 200, body: { ok: true, slots: ["2026-11-03T08:00:00.000Z", "2026-11-03T09:00:00.000Z"] } });
  assert.equal(calls[0].url, "https://projekt.supabase.co/rest/v1/rpc/audit_slots");
  assert.deepEqual(calls[0].body, { p_kind: "video" });
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.apikey, "oeffentlich");
  assert.equal(calls[0].init.headers.Authorization, "Bearer oeffentlich");
  assert.equal(calls[0].init.headers["Content-Profile"], "crm");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("an unknown kind of meeting is refused without asking the database", async () => {
  const response = await handleRequest(new Request(`${SITE}/api/termine?art=fax`), ENV);
  assert.deepEqual(await read(response), { status: 400, body: { ok: false, message: "Bitte eine Gesprächsart wählen." } });
  assert.equal(calls.length, 0);
});

test("a failing slot query is tried once more, then answered with a German sentence", async () => {
  answers.push(answer(503, { message: "upstream" }), answer(200, []));
  assert.deepEqual(await read(await handleRequest(new Request(`${SITE}/api/termine?art=call`), ENV)), { status: 200, body: { ok: true, slots: [] } });
  answers.push(answer(500, { code: "XX000", message: "internal detail" }), answer(500, { code: "XX000", message: "internal detail" }));
  const failed = await read(await handleRequest(new Request(`${SITE}/api/termine?art=call`), ENV));
  assert.equal(failed.status, 502);
  assert.equal(failed.body.message, "Die freien Termine lassen sich gerade nicht laden. Bitte versuchen Sie es in ein paar Minuten noch einmal.");
  assert.doesNotMatch(JSON.stringify(failed.body), /internal detail/);
});

test("a valid request goes to crm.request_audit with every parameter", async () => {
  answers.push(answer(200, { ok: true }));
  const response = await handleRequest(post(VALID), ENV);
  assert.deepEqual(await read(response), { status: 200, body: { ok: true } });
  assert.equal(calls[0].url, "https://projekt.supabase.co/rest/v1/rpc/request_audit");
  assert.deepEqual(calls[0].body, {
    p_company: "Dachdeckerei Muster",
    p_contact: "Erika Muster",
    p_email: "erika@dachdeckerei-muster.de",
    p_phone: "0251 123456",
    p_website: "https://dachdeckerei-muster.de/",
    p_address: "Musterweg 1, 48143 Münster",
    p_kind: "visit",
    p_starts_at: "2026-11-03T08:00:00.000Z",
    p_message: "Bitte vormittags.",
    p_utm_source: "linkedin",
    p_utm_medium: null,
    p_utm_campaign: "herbst",
    p_request_key: "0b6f4c1e-8d2a-4f7b-9c3e-5a1d2e3f4b6c",
  });
  assert.equal(Object.keys(calls[0].body).length, 13);
});

test("the German sentence the database raises reaches the visitor, nothing else does", async () => {
  answers.push(answer(400, { code: "P0001", message: "Dieser Termin ist leider schon vergeben.", details: "slot 42", hint: null }));
  assert.deepEqual(await read(await handleRequest(post(VALID), ENV)), {
    status: 422,
    body: { ok: false, message: "Dieser Termin ist leider schon vergeben." },
  });
  answers.push(answer(400, { code: "42883", message: "function crm.request_audit does not exist" }));
  const other = await read(await handleRequest(post(VALID), ENV));
  assert.equal(other.status, 502);
  assert.equal(other.body.message, "Die Anfrage ließ sich gerade nicht speichern. Bitte versuchen Sie es in ein paar Minuten noch einmal.");
});

test("a request is sent once only, even when the database fails", async () => {
  answers.push(answer(503, {}));
  assert.equal((await handleRequest(post(VALID), ENV)).status, 502);
  assert.equal(calls.length, 1);
  assert.deepEqual(logged.map((line) => JSON.parse(line)), [{ event: "request_audit_failed", status: 503, code: null, error: "DatabaseError" }]);
  assert.doesNotMatch(logged.join(""), /Erika|Muster/);
});

test("an unreachable database is answered with a German sentence", async () => {
  answers.push(() => {
    throw new TypeError("fetch failed");
  });
  const response = await read(await handleRequest(post(VALID), ENV));
  assert.equal(response.status, 502);
});

test("field errors come back per field before the database is asked", async () => {
  const response = await read(await handleRequest(post({ ...VALID, email: "erika", address: "" }), ENV));
  assert.equal(response.status, 400);
  assert.equal(response.body.message, "Bitte prüfen Sie die markierten Felder.");
  assert.deepEqual(Object.keys(response.body.fields).sort(), ["address", "email"]);
  assert.equal(calls.length, 0);
});

test("only JSON is accepted", async () => {
  const response = await read(await handleRequest(post("company=x", { "Content-Type": "application/x-www-form-urlencoded" }), ENV));
  assert.deepEqual(response, { status: 415, body: { ok: false, message: "Die Anfrage muss als JSON gesendet werden." } });
  assert.equal((await handleRequest(post("{kaputt"), ENV)).status, 400);
  assert.equal((await handleRequest(post([VALID]), ENV)).status, 400);
});

test("a body over the size limit is refused, whatever its header says", async () => {
  const big = JSON.stringify({ ...VALID, message: "x".repeat(40000) });
  assert.equal((await handleRequest(post(big), ENV)).status, 413);
  const lying = new Request(`${SITE}/api/anfrage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": "10" },
    body: big,
  });
  assert.equal((await handleRequest(lying, ENV)).status, 413);
});

test("unknown fields are refused", async () => {
  const response = await read(await handleRequest(post({ ...VALID, role: "admin" }), ENV));
  assert.deepEqual(response, { status: 400, body: { ok: false, message: "Die Anfrage enthält ein unbekanntes Feld." } });
});

test("wrong methods and unknown paths get 405 and 404", async () => {
  const get = await handleRequest(new Request(`${SITE}/api/anfrage`), ENV);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("Allow"), "POST");
  const put = await handleRequest(new Request(`${SITE}/api/termine?art=call`, { method: "PUT", body: "" }), ENV);
  assert.equal(put.headers.get("Allow"), "GET");
  assert.equal((await handleRequest(new Request(`${SITE}/api/sonstwas`), ENV)).status, 404);
});

test("without the database address the form says it is not available", async () => {
  const response = await read(await handleRequest(post(VALID), {}));
  assert.equal(response.status, 503);
  assert.equal(calls.length, 0);
  assert.equal((await handleRequest(post(VALID), { SUPABASE_URL: "http://unsicher.example", SUPABASE_ANON_KEY: "k" })).status, 503);
});

test("a request without a valid key never reaches the database", async () => {
  const response = await read(await handleRequest(post({ ...VALID, request_key: "nicht-eindeutig" }), ENV));
  assert.deepEqual(response, { status: 400, body: { ok: false, message: "Die Anfrage ist unvollständig. Bitte laden Sie die Seite neu." } });
  assert.equal(calls.length, 0);
});

test("a long message within the database limit fits into the body limit, even in umlauts", async () => {
  answers.push(answer(200, { ok: true }));
  assert.equal((await handleRequest(post({ ...VALID, message: "ä".repeat(5000) }), ENV)).status, 200);
});
