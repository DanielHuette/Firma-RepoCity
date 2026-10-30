// Unit tests of what the audit request form sends and where it leads: `node --test tests/*.test.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TARGET, createRequestKey, requestBody, targetAfterSending } from "../site/js/anfrage.js";

const TYPED = { company: "Dachdeckerei Muster", contact: "Erika Muster", kind: "call", starts_at: "2026-11-03T08:00:00.000Z" };

test("the form sends its fields and nothing it does not know", () => {
  assert.deepEqual(requestBody({ ...TYPED, extra: "x" }, ""), TYPED);
});

test("channel markers of the address travel with the request", () => {
  const body = requestBody(TYPED, "?utm_source=linkedin&utm_medium=social&utm_campaign=herbst");
  assert.deepEqual([body.utm_source, body.utm_medium, body.utm_campaign], ["linkedin", "social", "herbst"]);
});

test("without a source no markers are sent, and an overlong marker is left out", () => {
  assert.equal(requestBody(TYPED, "?utm_campaign=herbst").utm_campaign, undefined);
  const body = requestBody(TYPED, `?utm_source=linkedin&utm_campaign=${"x".repeat(101)}`);
  assert.equal(body.utm_source, "linkedin");
  assert.equal(body.utm_campaign, undefined);
});

test("after sending the visitor lands on the RadarAuditor page, keeping the markers", () => {
  assert.equal(TARGET, "https://radarauditor.speedofthespirit.dev/");
  assert.equal(targetAfterSending(""), TARGET);
  assert.equal(targetAfterSending("?utm_source=linkedin&utm_campaign=herbst"), `${TARGET}?utm_source=linkedin&utm_campaign=herbst`);
});

test("one key per sending: kept for a retry of the same input, new after a change, gone after success", () => {
  let made = 0;
  const key = createRequestKey(() => `k${++made}`);
  assert.equal(key.current(), "k1");
  assert.equal(key.current(), "k1");
  key.changed();
  assert.equal(key.current(), "k2");
  key.sent();
  assert.equal(key.current(), "k3");
});

test("the key of the browser is a random UUID", () => {
  assert.match(createRequestKey().current(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("the key travels in the body", () => {
  assert.equal(requestBody({ ...TYPED, request_key: "0b6f4c1e-8d2a-4f7b-9c3e-5a1d2e3f4b6c" }, "").request_key, "0b6f4c1e-8d2a-4f7b-9c3e-5a1d2e3f4b6c");
});
