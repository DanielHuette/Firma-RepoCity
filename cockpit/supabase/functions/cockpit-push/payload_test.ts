import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { pushPayload, type StoredMessage } from "./payload.ts";
import { MAX_PAYLOAD_BYTES } from "./webpush.ts";

const MESSAGE: StoredMessage = {
  id: "6f1c2a8e-3d4b-4c5d-8e9f-0a1b2c3d4e5f",
  app: "crm",
  kind: "pruefung-faellig",
  title: "Monatsprüfung fällig: Bäckerei Muster",
  body: "Die Prüfung für Oktober steht an.",
  link: "https://crm.speedofthespirit.dev/kunden/1",
  priority: "wichtig",
  tag: null,
  action_token: "0d7e9c1a-2b3c-4d5e-9f60-718293a4b5c6",
  actions: [{ action: "start_audit", title: "Prüfung auslösen" }],
};

function decode(message: StoredMessage): Record<string, unknown> {
  return JSON.parse(pushPayload(message)) as Record<string, unknown>;
}

Deno.test("tag falls back to the message id", () => {
  strictEqual(decode(MESSAGE).tag, MESSAGE.id);
  strictEqual(decode({ ...MESSAGE, tag: "" }).tag, MESSAGE.id);
});

Deno.test("stored tag is passed on so a later message replaces the earlier one", () => {
  strictEqual(decode({ ...MESSAGE, tag: "mail-42" }).tag, "mail-42");
});

Deno.test("action token travels with the payload", () => {
  strictEqual(decode(MESSAGE).token, MESSAGE.action_token);
});

Deno.test("payload keeps every field the service worker reads", () => {
  const payload = decode(MESSAGE);
  for (const key of ["id", "app", "kind", "priority", "title", "body", "link"]) {
    strictEqual(payload[key], MESSAGE[key as keyof StoredMessage], key);
  }
});

Deno.test("at most three actions are sent, in their stored order", () => {
  const actions = [
    { action: "audit_confirm", title: "Bestätigen" },
    { action: "audit_propose", title: "Anderen Termin vorschlagen" },
    { action: "audit_check", title: "Prüfen" },
    { action: "later", title: "Später" },
  ];
  deepStrictEqual(decode({ ...MESSAGE, actions }).actions, actions.slice(0, 3));
});

Deno.test("malformed actions are dropped", () => {
  const actions = [null, "approve", { action: "approve" }, { action: "", title: "Leer" }, { action: "reject", title: "Nicht senden", extra: 1 }];
  deepStrictEqual(decode({ ...MESSAGE, actions }).actions, [{ action: "reject", title: "Nicht senden" }]);
});

Deno.test("actions that are not a list become an empty list", () => {
  deepStrictEqual(decode({ ...MESSAGE, actions: { action: "approve", title: "Senden" } }).actions, []);
});

Deno.test("a long body is shortened so the encrypted record stays within the limit", () => {
  const payload = pushPayload({ ...MESSAGE, body: "Größe € ".repeat(600) });
  ok(new TextEncoder().encode(payload).length <= MAX_PAYLOAD_BYTES);
  ok((JSON.parse(payload) as { body: string }).body.startsWith("Größe € Größe"));
});

Deno.test("a short body stays complete", () => {
  strictEqual(decode(MESSAGE).body, MESSAGE.body);
});
