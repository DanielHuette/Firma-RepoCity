// Web Push without third-party code: payload encryption after RFC 8291 (aes128gcm) and sender
// identification after RFC 8292 (Voluntary Application Server Identification, a signed token).
// Context: runs in the Supabase Edge Function and in Node for tests; only Web Crypto is used.
// | Input: a browser subscription and a text payload. | Output: the request for the push service.

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SenderKeys {
  publicKey: string; // uncompressed P-256 point, base64url; the browser needs it to subscribe
  privateJwk: JsonWebKey;
}

/** Upper bound of the plain payload: one 4096-byte record minus padding and the AES tag. */
export const MAX_PAYLOAD_BYTES = 3800;

type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Bytes {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data));
}

/** HKDF with a single output block, which covers every length used here (at most 32 bytes). */
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

export async function generateSenderKeys(): Promise<SenderKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey: toBase64Url(publicRaw), privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey) };
}

/** Signed token that tells the push service who sends; valid for twelve hours. */
export async function senderToken(endpoint: string, keys: SenderKeys, contact: string, now = Date.now()): Promise<string> {
  const header = toBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = toBase64Url(encoder.encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: contact,
  })));
  const key = await crypto.subtle.importKey("jwk", { ...keys.privateJwk, key_ops: ["sign"] }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(`${header}.${claims}`)));
  return `${header}.${claims}.${toBase64Url(signature)}`;
}

/** Encrypts the payload for one browser (a single record, so the payload must stay under 4 kB). */
export async function encrypt(
  subscription: Subscription, payload: string,
  salt: Bytes = crypto.getRandomValues(new Uint8Array(16)),
  localPair?: CryptoKeyPair,
): Promise<Bytes> {
  const receiverPublic = fromBase64Url(subscription.p256dh);
  const authSecret = fromBase64Url(subscription.auth);
  const local = localPair ?? await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const localPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const receiverKey = await crypto.subtle.importKey("raw", receiverPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: receiverKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(encoder.encode("WebPush: info\0"), receiverPublic, localPublic), 32);
  const contentKey = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const data = encoder.encode(payload);
  if (data.length > MAX_PAYLOAD_BYTES) throw new Error("Push-Nachricht ist zu lang.");
  const aesKey = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, concat(data, new Uint8Array([2]))));

  const recordSize = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, recordSize, new Uint8Array([localPublic.length]), localPublic, cipher);
}

export interface PushRequest {
  url: string;
  init: RequestInit & { headers: Record<string, string>; body: Bytes };
}

export async function buildRequest(
  subscription: Subscription, payload: string, keys: SenderKeys, contact: string,
  options: { ttlSeconds: number; urgency: "very-low" | "low" | "normal" | "high"; topic?: string },
): Promise<PushRequest> {
  const headers: Record<string, string> = {
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(options.ttlSeconds),
    Urgency: options.urgency,
    Authorization: `vapid t=${await senderToken(subscription.endpoint, keys, contact)}, k=${keys.publicKey}`,
  };
  if (options.topic !== undefined) headers.Topic = options.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  return { url: subscription.endpoint, init: { method: "POST", headers, body: await encrypt(subscription, payload) } };
}
