// The mx.zohomail.eu samples are real headers of Daniel's Zoho EU mailbox with invented addresses.
// Further formats follow what Zoho writes: "mx.zohomail.com" with semicolons between the results
// (help.zoho.com, topic "Email SPF Hard Fail", message of 22 January 2025) and the older "mx.zoho.com"
// without a semicolon before spf (help.zoho.com, topic "Authentication-results Header format incorrect").
import { assertEquals } from "jsr:@std/assert@1";
import type { Header } from "./mail.ts";
import { senderVerified } from "./verification.ts";

const results = (...values: string[]): Header[] => values.map((value) => ({ key: "authentication-results", value }));
const withReceived = (headers: Header[]): Header[] => [...headers, { key: "received", value: "from mail.firma.de by mx.zohomail.com" }];
const FROM = "erika@firma.de";

Deno.test("dmarc pass from Zoho verifies the sender", () => {
  const headers = results("mx.zohomail.com; dkim=pass header.i=@firma.de header.s=mail; spf=pass (zohomail.com: domain of firma.de designates 1.2.3.4 as permitted sender) smtp.mailfrom=erika@firma.de; dmarc=pass(p=none dis=none) header.from=<erika@firma.de>");
  assertEquals(senderVerified(withReceived(headers), FROM), true);
});

Deno.test("dkim pass verifies when the signing domain is the From domain", () => {
  assertEquals(senderVerified(results("mx.zohomail.com; dkim=pass header.d=firma.de; spf=none; dmarc=none"), FROM), true);
  assertEquals(senderVerified(results("mx.zohomail.com; dkim=pass header.i=@Firma.DE; dmarc=none"), FROM), true);
  assertEquals(senderVerified(results("MX.ZohoMail.com; dkim=pass header.i=erika@firma.de"), FROM), true);
});

Deno.test("the older Zoho format without semicolons between results is read", () => {
  const header = "mx.zoho.com; dkim=pass header.d=firma.de spf=pass (zoho.com: domain of _spf.firma.de designates 1.2.3.4 as permitted sender) smtp.mailfrom=erika@firma.de;";
  assertEquals(senderVerified(results(header), FROM), true);
});

Deno.test("a signature of another domain, failed checks or no checks do not verify", () => {
  assertEquals(senderVerified(results("mx.zohomail.com; dkim=pass header.d=newsletter-dienst.example; dmarc=none"), FROM), false);
  assertEquals(senderVerified(results("mx.zohomail.com; dkim=fail header.d=firma.de; spf=pass smtp.mailfrom=erika@firma.de; dmarc=fail header.from=firma.de"), FROM), false);
  assertEquals(senderVerified(results("mx.zohomail.com; dmarc=pass header.from=andere.de"), FROM), false);
  assertEquals(senderVerified([{ key: "received", value: "x" }], FROM), false);
});

Deno.test("results hidden in a comment do not count", () => {
  assertEquals(senderVerified(results("mx.zohomail.com; dkim=fail (dkim=pass header.d=firma.de) header.d=firma.de; dmarc=fail (dmarc=pass)"), FROM), false);
});

Deno.test("forged results are ignored: only the topmost header of Zoho counts", () => {
  const genuineFail = "mx.zohomail.com; dkim=none; spf=fail smtp.mailfrom=erika@firma.de; dmarc=fail header.from=firma.de";
  const forgedPass = "mx.zohomail.com; dkim=pass header.d=firma.de; dmarc=pass header.from=firma.de";
  assertEquals(senderVerified(results(genuineFail, forgedPass), FROM), false);
  assertEquals(senderVerified(results("mx.google.com; dkim=pass header.d=firma.de; dmarc=pass header.from=firma.de"), FROM), false);
  assertEquals(senderVerified(results("mx.angreifer.example; dmarc=fail", forgedPass), FROM), false);
});

const GMX = "Authentication-Results: mx.zohomail.eu; dkim=pass  header.i=erika.muster@gmx.net; spf=pass (zohomail.eu: domain of _spf.gmx.net designates 212.227.15.15 as permitted sender)  smtp.mailfrom=erika.muster@gmx.net; dmarc=pass(p=quarantine dis=none)  header.from=gmx.net";
const QDRANT = "Authentication-Results: mx.zohomail.eu; dkim=pass; spf=pass (zohomail.eu: domain of qdrant.com designates 209.85.208.179 as permitted sender)  smtp.mailfrom=team@qdrant.com; arc=pass (i=1 dmarc=pass fromdomain=qdrant.com); dmarc=pass(p=none dis=none)  header.from=qdrant.com";
const value = (line: string) => line.slice(line.indexOf(":") + 1).trim();

Deno.test("real headers of the Zoho EU mailbox verify their senders", () => {
  assertEquals(senderVerified(results(value(GMX)), "erika.muster@gmx.net"), true);
  assertEquals(senderVerified(results(value(QDRANT)), "team@qdrant.com"), true);
});

Deno.test("dmarc pass only counts for the From domain of the mail", () => {
  assertEquals(senderVerified(results(value(QDRANT)), "erika@firma.de"), false);
  assertEquals(senderVerified(results(value(GMX)), "erika.muster@web.de"), false);
  assertEquals(senderVerified(results("mx.zohomail.eu; dkim=pass; dmarc=pass(p=none dis=none)"), FROM), false);
});
