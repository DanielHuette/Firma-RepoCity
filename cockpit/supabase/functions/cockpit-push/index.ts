// Push sender of the Cockpit: delivers one message to every registered device and hands the app
// the public sender key it needs to subscribe.
// Context: Supabase Edge Function (Deno), called by cockpit.push() through pg_net with the service
// key, or by the signed-in administrator from the app. | Input: POST {action: "key"} or
// {action: "send", message_id}. | Output: JSON with the key or the delivery report.
import { pushPayload, pushTag, type StoredMessage } from "./payload.ts";
import { buildRequest, generateSenderKeys, type SenderKeys, type Subscription } from "./webpush.ts";

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
