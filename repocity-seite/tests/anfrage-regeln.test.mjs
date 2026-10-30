// Unit tests of the audit request rules shared by form and server: `node --test tests/*.test.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELDS, KINDS, LIMITS, checkRequest, normaliseWebsite } from "../site/js/anfrage-regeln.js";

const VALID = {
  company: "Dachdeckerei Muster",
  contact: "Erika Muster",
  email: "erika@dachdeckerei-muster.de",
  phone: "0251 123456",
  kind: "call",
  starts_at: "2026-11-03T09:00:00.000Z",
  request_key: "0b6f4c1e-8d2a-4f7b-9c3e-5a1d2e3f4b6c",
};

test("the three kinds of meeting are visit, call and video", () => {
  assert.deepEqual(KINDS, { visit: "Vor Ort", call: "Telefon", video: "Video" });
});

test("a complete request passes with trimmed values and empty optional fields as null", () => {
  const result = checkRequest({ ...VALID, company: "  Dachdeckerei Muster ", message: "  " });
  assert.equal(result.ok, true);
  assert.deepEqual(result.values, {
    company: "Dachdeckerei Muster",
    contact: "Erika Muster",
    email: "erika@dachdeckerei-muster.de",
    phone: "0251 123456",
    website: null,
    address: null,
    kind: "call",
    starts_at: "2026-11-03T09:00:00.000Z",
    message: null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    request_key: "0b6f4c1e-8d2a-4f7b-9c3e-5a1d2e3f4b6c",
  });
});

test("every required field missing is named in German", () => {
  const result = checkRequest({ request_key: VALID.request_key });
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ["company", "contact", "email", "kind", "phone", "starts_at"]);
  assert.equal(result.errors.company, "Bitte den Namen des Betriebs eingeben.");
  assert.equal(result.errors.kind, "Bitte eine Gesprächsart wählen.");
  assert.equal(result.errors.starts_at, "Bitte einen Wunschtermin wählen.");
});

test("a visit needs the address, a call and a video drop it", () => {
  assert.equal(checkRequest({ ...VALID, kind: "visit" }).errors.address, "Für ein Gespräch vor Ort bitte die Anschrift eingeben.");
  const visit = checkRequest({ ...VALID, kind: "visit", address: "Musterweg 1, 48143 Münster" });
  assert.equal(visit.values.address, "Musterweg 1, 48143 Münster");
  assert.equal(checkRequest({ ...VALID, kind: "video", address: "Musterweg 1" }).values.address, null);
});

test("an e-mail address needs an @ and a domain", () => {
  for (const email of ["erika", "erika@", "erika@muster", "er ika@muster.de"]) {
    assert.equal(checkRequest({ ...VALID, email }).errors.email, "Bitte eine E-Mail-Adresse wie name@betrieb.de eingeben.", email);
  }
});

test("a phone number follows the rule of the database: + only in front, 6 to 20 digits", () => {
  assert.equal(checkRequest({ ...VALID, phone: "+49 (251) 12-34/56" }).ok, true);
  assert.equal(checkRequest({ ...VALID, phone: "0251.123456" }).ok, true);
  for (const phone of ["12345", "0251 abc 123456", "0251 +123456", "0251\t123456", "1".repeat(21)]) {
    assert.equal(checkRequest({ ...VALID, phone }).errors.phone, "Bitte eine Telefonnummer wie 0251 123456 eingeben.", phone);
  }
});

test("an unknown kind and a malformed time are refused", () => {
  assert.equal(checkRequest({ ...VALID, kind: "fax" }).errors.kind, "Bitte eine Gesprächsart wählen.");
  for (const starts_at of ["morgen", "2026-11-03", "2026-13-03T09:00:00Z"]) {
    assert.equal(checkRequest({ ...VALID, starts_at }).errors.starts_at, "Bitte einen Wunschtermin wählen.", starts_at);
  }
  assert.equal(checkRequest({ ...VALID, starts_at: "2026-11-03T10:00:00+01:00" }).ok, true);
});

test("a website is completed to an https address and must name a domain", () => {
  assert.equal(checkRequest({ ...VALID, website: "dachdeckerei-muster.de" }).values.website, "https://dachdeckerei-muster.de/");
  assert.equal(checkRequest({ ...VALID, website: "http://muster.de/kontakt" }).values.website, "http://muster.de/kontakt");
  assert.equal(checkRequest({ ...VALID, website: "muster" }).errors.website, "Bitte eine Webseiten-Adresse wie betrieb.de eingeben.");
  assert.equal(normaliseWebsite("ftp://muster.de"), null);
});

test("every field has an upper length and says so", () => {
  for (const field of FIELDS) assert.ok(LIMITS[field] > 0, field);
  const result = checkRequest({ ...VALID, company: "x".repeat(LIMITS.company + 1) });
  assert.equal(result.errors.company, `Bitte höchstens ${LIMITS.company} Zeichen eingeben.`);
});

test("values that are not text and fields that do not exist are refused", () => {
  assert.equal(checkRequest({ ...VALID, phone: 251123456 }).errors.phone, "Bitte eine Telefonnummer wie 0251 123456 eingeben.");
  assert.equal(checkRequest({ ...VALID, admin: true }).errors.form, "Die Anfrage enthält ein unbekanntes Feld.");
  assert.equal(checkRequest(null).errors.form, "Die Anfrage ist leer.");
  assert.equal(checkRequest(["x"]).errors.form, "Die Anfrage ist leer.");
});

test("channel markers travel along and are trimmed", () => {
  const result = checkRequest({ ...VALID, utm_source: " linkedin ", utm_medium: "social", utm_campaign: "herbst" });
  assert.deepEqual([result.values.utm_source, result.values.utm_medium, result.values.utm_campaign], ["linkedin", "social", "herbst"]);
});

test("company and contact need 2 to 200 characters, e-mail at most 200, as the database", () => {
  assert.equal(LIMITS.company, 200);
  assert.equal(LIMITS.contact, 200);
  assert.equal(LIMITS.email, 200);
  assert.equal(checkRequest({ ...VALID, company: "X" }).errors.company, "Bitte den Namen des Betriebs eingeben (mindestens 2 Zeichen).");
  assert.equal(checkRequest({ ...VALID, contact: " Y " }).errors.contact, "Bitte einen Ansprechpartner eingeben (mindestens 2 Zeichen).");
  assert.equal(checkRequest({ ...VALID, company: "AB" }).ok, true);
  const email = `${"e".repeat(191)}@muster.de`;
  assert.equal(checkRequest({ ...VALID, email }).errors.email, "Bitte höchstens 200 Zeichen eingeben.");
});

test("an address for a visit needs at least five characters, a message at most 5000", () => {
  assert.equal(checkRequest({ ...VALID, kind: "visit", address: "Weg" }).errors.address, "Für ein Gespräch vor Ort bitte die Anschrift eingeben.");
  assert.equal(LIMITS.message, 5000);
  assert.equal(checkRequest({ ...VALID, message: "x".repeat(5000) }).ok, true);
});

test("every request carries a key in UUID form, refused as a whole when it is missing or broken", () => {
  const { request_key: _, ...without } = VALID;
  for (const input of [without, { ...VALID, request_key: "123" }, { ...VALID, request_key: 5 }]) {
    assert.equal(checkRequest(input).errors.form, "Die Anfrage ist unvollständig. Bitte laden Sie die Seite neu.");
  }
});
