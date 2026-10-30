// Unit tests of the address rules: `node --test tests/`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lesen, schreiben, TEILE, REITER } from "../site/js/adresse.js";

test("no hash and #uebersicht open the overview", () => {
  for (const h of ["", "#", "#uebersicht", "#UEBERSICHT"]) assert.deepEqual(lesen(h), { ansicht: "uebersicht", reiter: "uebersicht" });
});

test("#praesentation opens the company presentation", () => {
  assert.deepEqual(lesen("#praesentation"), { ansicht: "uebersicht", reiter: "praesentation" });
});

test("a part name opens that part on its presentation", () => {
  for (const t of TEILE) assert.deepEqual(lesen("#" + t), { ansicht: t, reiter: "praesentation" });
});

test("part and tab open that tab", () => {
  for (const t of TEILE) for (const r of REITER) assert.deepEqual(lesen(`#${t}-${r}`), { ansicht: t, reiter: r });
});

test("unknown anchors leave the view alone", () => {
  for (const h of ["#inhalt", "#crm-", "#crm-foo", "#foo-projekt", "#%E0%A4%A"]) assert.equal(lesen(h), null);
});

test("writing and reading round-trip", () => {
  assert.equal(schreiben({ ansicht: "uebersicht", reiter: "uebersicht" }), "#uebersicht");
  assert.equal(schreiben({ ansicht: "uebersicht", reiter: "praesentation" }), "#praesentation");
  for (const t of TEILE) for (const r of REITER) assert.deepEqual(lesen(schreiben({ ansicht: t, reiter: r })), { ansicht: t, reiter: r });
});
