import PostalMime from "npm:postal-mime@2.4.4";
import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { buildMime } from "./smtp.ts";

Deno.test("MIME message round-trips through the parser with attachment and umlauts", async () => {
  const raw = buildMime({ fromName: "Erika Beispiel | Beispielfirma", from: "post@beispiel.test", to: "kunde@example.org",
    subject: "Wartungs- und Servicevertrag VT-2026-0001", body: "Guten Tag Frau Müller,\n.\nanbei der Vertrag.", messageId: "<abc@beispiel.test>",
    attachment: { name: "Vertrag.pdf", bytes: new Uint8Array([37, 80, 68, 70, 45, 49]), type: "application/pdf" } });
  const parsed = await PostalMime.parse(raw);
  assertEquals(parsed.from?.name, "Erika Beispiel | Beispielfirma");
  assertEquals(parsed.subject, "Wartungs- und Servicevertrag VT-2026-0001");
  assertStringIncludes(parsed.text ?? "", "Frau Müller");
  assertEquals(parsed.attachments.length, 1);
  assertEquals(parsed.attachments[0].filename, "Vertrag.pdf");
  assertEquals(parsed.messageId, "<abc@beispiel.test>");
});

Deno.test("MIME message without attachment is plain text", async () => {
  const raw = buildMime({ fromName: "Erika", from: "post@beispiel.test", to: "kunde@example.org", subject: "Bewertung", body: "Danke!", messageId: "<x@beispiel.test>" });
  const parsed = await PostalMime.parse(raw);
  assertEquals(parsed.attachments.length, 0);
  assertEquals(parsed.text?.trim(), "Danke!");
});

const UNSUBSCRIBE = "https://beispiel.supabase.co/functions/v1/crm-abmelden?t=3f8e2a10-6b7c-4d5e-8f90-a1b2c3d4e5f6";
const header = (raw: Uint8Array, name: string) =>
  new TextDecoder().decode(raw).split("\r\n").filter((line) => line.toLowerCase().startsWith(`${name.toLowerCase()}:`));

Deno.test("a mail with opt-out address carries both one-click headers of RFC 8058", async () => {
  const raw = buildMime({ fromName: "Erika", from: "post@beispiel.test", to: "kunde@example.org", subject: "Nachfrage", body: "Text",
    messageId: "<n@beispiel.test>", listUnsubscribe: UNSUBSCRIBE });
  assertEquals(header(raw, "List-Unsubscribe"), [`List-Unsubscribe: <${UNSUBSCRIBE}>`]);
  assertEquals(header(raw, "List-Unsubscribe-Post"), ["List-Unsubscribe-Post: List-Unsubscribe=One-Click"]);
  const parsed = await PostalMime.parse(raw);
  assertEquals(parsed.headers.find((entry) => entry.key === "list-unsubscribe")?.value, `<${UNSUBSCRIBE}>`);
  assertEquals(parsed.text?.trim(), "Text");
});

Deno.test("a mail without opt-out address has no unsubscribe headers", () => {
  const raw = buildMime({ fromName: "Erika", from: "post@beispiel.test", to: "kunde@example.org", subject: "Rechnung", body: "Text",
    messageId: "<r@beispiel.test>", listUnsubscribe: "" });
  assertEquals([header(raw, "List-Unsubscribe"), header(raw, "List-Unsubscribe-Post")], [[], []]);
});

Deno.test("an opt-out address that is not one plain HTTPS address is refused", () => {
  for (const address of ["http://beispiel.test/x", "https://beispiel.test/x>\r\nBcc: a@b.de", "https://beispiel.test/a b", "mailto:x@beispiel.test"]) {
    assertThrows(() => buildMime({ fromName: "Erika", from: "post@beispiel.test", to: "kunde@example.org", subject: "x", body: "x",
      messageId: "<x@beispiel.test>", listUnsubscribe: address }), Error, "Abmeldeadresse");
  }
});

Deno.test("a calendar attachment keeps its type with the method parameter", async () => {
  const ics = new TextEncoder().encode("BEGIN:VCALENDAR\r\nMETHOD:PUBLISH\r\nEND:VCALENDAR\r\n");
  const raw = buildMime({ fromName: "Erika", from: "post@beispiel.test", to: "kunde@example.org", subject: "Terminbestätigung", body: "Text",
    messageId: "<t@beispiel.test>", attachment: { name: "Termin_2026-10-31.ics", bytes: ics, type: "text/calendar; charset=utf-8; method=PUBLISH" } });
  const parsed = await PostalMime.parse(raw);
  assertEquals([parsed.attachments.length, parsed.attachments[0].mimeType, parsed.attachments[0].filename], [1, "text/calendar", "Termin_2026-10-31.ics"]);
  assertStringIncludes(new TextDecoder().decode(raw), 'Content-Type: text/calendar; charset=utf-8; method=PUBLISH; name="Termin_2026-10-31.ics"');
});
