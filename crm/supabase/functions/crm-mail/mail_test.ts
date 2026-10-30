import PostalMime from "npm:postal-mime@2.4.4";
import { assert, assertEquals } from "jsr:@std/assert@1";
import { automatedReason, keptAttachments, mailDate, parties, plainText, safeName } from "./mail.ts";

const parse = (raw: string) => PostalMime.parse(raw);

Deno.test("automatic senders are recognised, people are not", () => {
  assert(automatedReason("noreply@shop.de", []) !== null);
  assert(automatedReason("info@firma.de", [{ key: "list-unsubscribe", value: "<mailto:x>" }]) !== null);
  assert(automatedReason("info@firma.de", [{ key: "auto-submitted", value: "auto-replied" }]) !== null);
  assertEquals(automatedReason("info@firma.de", [{ key: "auto-submitted", value: "no" }]), null);
  assertEquals(automatedReason("erika@firma.de", []), null);
});

Deno.test("incoming mail has the sender as its one party", async () => {
  const parsed = await parse("From: Erika <Erika@Firma.de>\r\nTo: post@beispiel.test\r\nSubject: Hallo\r\n\r\nText");
  assertEquals(parties(parsed, "beispiel.test", "inbox"), { direction: "in", parties: [{ address: "erika@firma.de", name: "Erika" }] });
});

Deno.test("outgoing mail has every recipient outside the own domain as party", async () => {
  const parsed = await parse("From: post@beispiel.test\r\nTo: a@x.de, kollege@beispiel.test\r\nCc: B <b@y.de>\r\nSubject: Hallo\r\n\r\nText");
  assertEquals(parties(parsed, "beispiel.test", "inbox"), { direction: "out", parties: [{ address: "a@x.de", name: "" }, { address: "b@y.de", name: "B" }] });
});

Deno.test("plain text falls back to the HTML part without tags", async () => {
  const parsed = await parse("From: a@x.de\r\nContent-Type: text/html\r\n\r\n<p>Hallo&nbsp;Welt</p><style>p{}</style><br>Zeile");
  assertEquals(plainText(parsed), "Hallo Welt\n\n\nZeile".replace(/\n{3,}/g, "\n\n"));
});

Deno.test("a mail without date gets the fallback time", async () => {
  const parsed = await parse("From: a@x.de\r\nSubject: x\r\n\r\nText");
  assertEquals(mailDate(parsed, new Date("2026-10-24T08:00:00Z")), "2026-10-24T08:00:00.000Z");
});

Deno.test("small inline images are not kept as documents, real attachments are", async () => {
  const raw = ["From: a@x.de", "Content-Type: multipart/mixed; boundary=b", "", "--b", "Content-Type: text/plain", "", "Text", "--b",
    "Content-Type: image/png", "Content-Disposition: inline; filename=logo.png", "Content-Transfer-Encoding: base64", "", "iVBORw0KGgo=", "--b",
    "Content-Type: application/pdf", "Content-Disposition: attachment; filename=angebot.pdf", "Content-Transfer-Encoding: base64", "", "JVBERi0=", "--b--", ""].join("\r\n");
  const kept = keptAttachments(await parse(raw));
  assertEquals(kept.map((file) => file.filename), ["angebot.pdf"]);
});

Deno.test("file names are reduced to safe characters", () => {
  assertEquals(safeName("Angebot März 2026.pdf"), "Angebot_Maerz_2026.pdf");
  assertEquals(safeName("///"), "_");
  assertEquals(safeName("Café Größe"), "Cafe_Groesse");
});
