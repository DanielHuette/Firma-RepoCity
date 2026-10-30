// Push sender of the Cockpit: delivers one message to every registered device and hands the app
// the public sender key it needs to subscribe.
// Context: Supabase Edge Function (Deno), called by cockpit.push() through pg_net with the service
// key, or by the signed-in administrator from the app. | Input: POST {action: "key"} or
// {action: "send", message_id}. | Output: JSON with the key or the delivery report.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SERVICE_HEADERS: Record<string, string> = SERVICE_KEY.startsWith("eyJ")
  ? { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } : { apikey: SERVICE_KEY };
const CONTACT = "https://cockpit.speedofthespirit.dev";
const MESSAGE_FIELDS = "id,app,kind,title,body,link,priority,tag,action_token,actions";
const ALLOWED_ORIGINS = ["https://cockpit.speedofthespirit.dev", "https://repocity-cockpit.pages.dev", "http://localhost:5173"];

interface StoredSubscription extends Subscription {
  id: string;
  failures: number;
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = { ...SERVICE_HEADERS, "Accept-Profile": "cockpit", "Content-Profile": "cockpit", "Content-Type": "application/json" };
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  if (!response.ok) throw new Error(`Datenbank ${String(response.status)}: ${await response.text()}`);
  return response;
}

async function senderKeys(): Promise<SenderKeys> {
  const rows = await (await rest("push_keys?select=public_key,private_jwk")).json() as { public_key: string; private_jwk: JsonWebKey }[];
  if (rows.length > 0) return { publicKey: rows[0].public_key, privateJwk: rows[0].private_jwk };
  const fresh = await generateSenderKeys();
  // Two first calls at once: the second insert is ignored and both read the stored pair.
  await rest("push_keys?on_conflict=id", {
    method: "POST", headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({ id: true, public_key: fresh.publicKey, private_jwk: fresh.privateJwk }),
  });
  return senderKeys();
}

type Outcome = { kind: "delivered" | "removed" } | { kind: "failed"; error: string };

interface Delivery {
  payload: string;
  keys: SenderKeys;
  urgency: "normal" | "high";
  topic: string;
}

/** Sends to one device and keeps its record in step: reset, removed, or one more failure. */
async function deliver(subscription: StoredSubscription, delivery: Delivery): Promise<Outcome> {
  const target = `push_subscriptions?id=eq.${subscription.id}`;
  try {
    const request = await buildRequest(subscription, delivery.payload, delivery.keys, CONTACT, {
      ttlSeconds: 24 * 3600, urgency: delivery.urgency, topic: delivery.topic,
    });
    const response = await fetch(request.url, { ...request.init, signal: AbortSignal.timeout(15000) });
    if (response.ok) {
      await rest(target, { method: "PATCH", body: JSON.stringify({ last_ok_at: new Date().toISOString(), failures: 0 }) });
      return { kind: "delivered" };
    }
    if (response.status === 404 || response.status === 410) {
      // The browser withdrew the subscription (app removed, permission revoked).
      await rest(target, { method: "DELETE" });
      return { kind: "removed" };
    }
    const error = `${String(response.status)} ${(await response.text()).slice(0, 200)}`;
    await rest(target, { method: "PATCH", body: JSON.stringify({ failures: subscription.failures + 1 }) });
    return { kind: "failed", error };
  } catch (error) {
    return { kind: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

async function send(messageId: string): Promise<{ delivered: number; removed: number; failed: number }> {
  const messages = await (await rest(`messages?id=eq.${encodeURIComponent(messageId)}&select=${MESSAGE_FIELDS}`)).json() as StoredMessage[];
  if (messages.length === 0) throw new Error("Nachricht nicht gefunden.");
  const message = messages[0];
  const subscriptions = await (await rest("push_subscriptions?select=id,endpoint,p256dh,auth,failures")).json() as StoredSubscription[];
  const delivery: Delivery = {
    payload: pushPayload(message), keys: await senderKeys(), urgency: message.priority === "info" ? "normal" : "high",
    // The push service drops a waiting message when a newer one with the same topic arrives, which
    // is wanted only for messages that replace each other on the device (same tag).
    topic: pushTag(message),
  };
  const outcomes = await Promise.all(subscriptions.map((subscription) => deliver(subscription, delivery)));
  const report = { delivered: 0, removed: 0, failed: 0 };
  for (const outcome of outcomes) report[outcome.kind] += 1;
  const errors = outcomes.flatMap((outcome) => (outcome.kind === "failed" ? [outcome.error] : []));
  await rest(`messages?id=eq.${message.id}`, {
    method: "PATCH",
    body: JSON.stringify({ pushed_at: report.delivered > 0 ? new Date().toISOString() : null, push_error: errors.join(" | ").slice(0, 1000) }),
  });
  return report;
}

// The gateway has already verified the signature (Verify JWT is on), so reading the role is safe.
function jwtRole(token: string): string {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return String((JSON.parse(atob(payload)) as { role?: unknown }).role ?? "");
  } catch {
    return "";
  }
}

async function caller(request: Request): Promise<"service" | "admin" | null> {
  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (token === "") return null;
  if (token === SERVICE_KEY || jwtRole(token) === "service_role") return "service";
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: "POST", headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "", Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}",
  });
  return response.ok && (await response.json()) === true ? "admin" : null;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") ?? "";
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin",
  };
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return answer(405, { error: "Nur POST." });
  if (await caller(request) === null) return answer(401, { error: "Kein Zugriff." });
  try {
    const input = await request.json() as { action?: string; message_id?: string };
    if (input.action === "key") return answer(200, { publicKey: (await senderKeys()).publicKey });
    if (input.action === "send" && typeof input.message_id === "string") return answer(200, await send(input.message_id));
    return answer(400, { error: "Unbekannte Aktion." });
  } catch (error) {
    return answer(500, { error: error instanceof Error ? error.message : String(error) });
  }
});


// ---- Payload ----
// What the service worker receives for one message: the text, the notification tag and the
// one-tap actions with the token that proves the tap came from this push.
// Context: shared by the Edge Function and its tests. | Input: a row of cockpit.messages. | Output:
// the JSON text that is encrypted for every device.

interface PushAction {
  action: string;
  title: string;
}

interface StoredMessage {
  id: string;
  app: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  priority: "info" | "wichtig" | "dringend";
  tag: string | null;
  action_token: string;
  actions: unknown;
}

const MAX_ACTIONS = 3;
const MAX_BODY_CHARACTERS = 1500;

function isAction(entry: unknown): entry is PushAction {
  if (typeof entry !== "object" || entry === null) return false;
  const { action, title } = entry as Record<string, unknown>;
  return typeof action === "string" && action !== "" && typeof title === "string" && title !== "";
}

/** At most three buttons, as cockpit.valid_actions allows; the browser shows as many as it can (Chromium two). */
function pushActions(stored: unknown): PushAction[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter(isAction).slice(0, MAX_ACTIONS).map(({ action, title }) => ({ action, title }));
}

/** Notification tag: a later message with the same tag replaces the earlier one on the device. */
function pushTag(message: Pick<StoredMessage, "id" | "tag">): string {
  return message.tag === null || message.tag === "" ? message.id : message.tag;
}

function encodedLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** JSON payload of one message; the body is shortened until the encrypted record fits. */
function pushPayload(message: StoredMessage): string {
  const fields = {
    id: message.id, app: message.app, kind: message.kind, priority: message.priority,
    title: message.title, body: "", link: message.link,
    tag: pushTag(message),
    token: message.action_token, actions: pushActions(message.actions),
  };
  const characters = Array.from(message.body).slice(0, MAX_BODY_CHARACTERS);
  let payload = JSON.stringify({ ...fields, body: characters.join("") });
  const overflow = encodedLength(payload) - MAX_PAYLOAD_BYTES;
  // Every removed character frees at least one byte, so one cut is enough.
  if (overflow > 0) payload = JSON.stringify({ ...fields, body: characters.slice(0, Math.max(0, characters.length - overflow)).join("") });
  return payload;
}


// ---- Web Push ----
// Web Push without third-party code: payload encryption after RFC 8291 (aes128gcm) and sender
// identification after RFC 8292 (Voluntary Application Server Identification, a signed token).
// Context: runs in the Supabase Edge Function and in Node for tests; only Web Crypto is used.
// | Input: a browser subscription and a text payload. | Output: the request for the push service.

interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface SenderKeys {
  publicKey: string; // uncompressed P-256 point, base64url; the browser needs it to subscribe
  privateJwk: JsonWebKey;
}

/** Upper bound of the plain payload: one 4096-byte record minus padding and the AES tag. */
const MAX_PAYLOAD_BYTES = 3800;

type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Bytes {
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

async function generateSenderKeys(): Promise<SenderKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey: toBase64Url(publicRaw), privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey) };
}

/** Signed token that tells the push service who sends; valid for twelve hours. */
async function senderToken(endpoint: string, keys: SenderKeys, contact: string, now = Date.now()): Promise<string> {
  const header = toBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = toBase64Url(encoder.encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: contact,
  })));
  const key = await crypto.subtle.importKey("jwk", { ...keys.privateJwk, key_ops: ["sign"] }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(`${header}.${claims}`)));
  return `${header}.${claims}.${toBase64Url(signature)}`;
}

/** Encrypts the payload for one browser (a single record, so the payload must stay under 4 kB). */
async function encrypt(
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

interface PushRequest {
  url: string;
  init: RequestInit & { headers: Record<string, string>; body: Bytes };
}

async function buildRequest(
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
