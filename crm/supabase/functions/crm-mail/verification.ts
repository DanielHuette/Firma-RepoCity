// Whether an incoming mail really comes from the domain in its From address, judged from the
// Authentication-Results header (RFC 8601) the receiving mailbox provider wrote. Senders can put
// such headers into their own mail, so only the topmost one counts, it must carry the provider's
// authserv-id, and a second header with that id makes the mail unverified.
import { ZOHO_AUTHSERV_IDS } from "./config.ts";
import type { Header } from "./mail.ts";

interface MethodResult { method: string; result: string; properties: Map<string, string> }

function withoutComments(value: string): string {
  let text = value;
  for (let previous = ""; previous !== text;) {
    previous = text;
    text = text.replace(/\([^()]*\)/g, " ");
  }
  return text;
}

function authservId(value: string): string {
  return withoutComments(value).split(";")[0].trim().split(/\s+/)[0].toLowerCase();
}

// Results are read token by token, so Zoho's older format without a semicolon between two
// results is understood as well as the standard one.
function methodResults(value: string): MethodResult[] {
  const text = withoutComments(value);
  const results: MethodResult[] = [];
  for (const token of text.slice(text.indexOf(";") + 1).split(/[\s;]+/)) {
    const match = /^([a-z0-9-]+(?:\.[a-z0-9-]+)?)=(.*)$/i.exec(token);
    if (match === null) continue;
    const key = match[1].toLowerCase();
    if (!key.includes(".") && key !== "reason") results.push({ method: key, result: match[2].toLowerCase(), properties: new Map() });
    else results.at(-1)?.properties.set(key, match[2]);
  }
  return results;
}

function domainOf(value: string | undefined): string {
  const bare = (value ?? "").replace(/[<>"]/g, "").trim().toLowerCase();
  return bare.slice(bare.lastIndexOf("@") + 1);
}

function passes(result: MethodResult, fromDomain: string): boolean {
  if (result.result !== "pass") return false;
  if (result.method === "dmarc") return domainOf(result.properties.get("header.from")) === fromDomain;
  if (result.method !== "dkim") return false;
  const signer = result.properties.get("header.d") ?? result.properties.get("header.i");
  return signer !== undefined && domainOf(signer) === fromDomain;
}

export function senderVerified(headers: Header[], fromAddress: string, trusted: readonly string[] = ZOHO_AUTHSERV_IDS): boolean {
  const results = headers.filter((header) => header.key.toLowerCase() === "authentication-results").map((header) => header.value);
  const fromTrusted = results.filter((value) => trusted.includes(authservId(value)));
  if (results.length === 0 || fromTrusted.length !== 1 || fromTrusted[0] !== results[0]) return false;
  const fromDomain = domainOf(fromAddress);
  return fromDomain !== "" && methodResults(results[0]).some((result) => passes(result, fromDomain));
}
