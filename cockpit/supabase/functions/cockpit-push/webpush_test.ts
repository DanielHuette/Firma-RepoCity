// Checks the encryption against the worked example of RFC 8291, Appendix A, and the sender token
// against its own public key.
import { ok, strictEqual } from "node:assert/strict";
import { buildRequest, encrypt, fromBase64Url, generateSenderKeys, senderToken, toBase64Url } from "./webpush.ts";

const RECEIVER = {
  endpoint: "https://push.example.net/x",
  p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
};

async function ecdhPair(publicB64: string, privateB64: string): Promise<CryptoKeyPair> {
  const pub = fromBase64Url(publicB64);
  const jwk = { kty: "EC", crv: "P-256", x: toBase64Url(pub.slice(1, 33)), y: toBase64Url(pub.slice(33)), d: privateB64, ext: true };
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = await crypto.subtle.importKey("raw", pub, { name: "ECDH", namedCurve: "P-256" }, true, []);
  return { privateKey, publicKey };
}

Deno.test("encryption matches the worked example of RFC 8291", async () => {
  const local = await ecdhPair(
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
    "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw");
  const body = await encrypt(RECEIVER, "When I grow up, I want to be a watermelon", fromBase64Url("DGv6ra1nlYgDCS1FRnbzlw"), local);
  strictEqual(toBase64Url(body), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
});

Deno.test("sender token is signed with the sender key and names the push service", async () => {
  const keys = await generateSenderKeys();
  const token = await senderToken("https://fcm.googleapis.com/fcm/send/abc", keys, "mailto:test@example.org", 0);
  const [header = "", claims = "", signature = ""] = token.split(".");
  const publicKey = await crypto.subtle.importKey("raw", fromBase64Url(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, fromBase64Url(signature), new TextEncoder().encode(`${header}.${claims}`)));
  const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(claims))) as { aud: string; exp: number };
  strictEqual(decoded.aud, "https://fcm.googleapis.com");
  strictEqual(decoded.exp, 43200);
});

Deno.test("topic header keeps at most 32 allowed characters of the notification tag", async () => {
  const keys = await generateSenderKeys();
  const request = await buildRequest(RECEIVER, "{}", keys, "mailto:test@example.org", {
    ttlSeconds: 60, urgency: "high", topic: "mail-6f1c2a8e-3d4b-4c5d-8e9f-0a1b2c3d4e5f",
  });
  strictEqual(request.init.headers.Topic, "mail-6f1c2a8e-3d4b-4c5d-8e9f-0a1");
});
