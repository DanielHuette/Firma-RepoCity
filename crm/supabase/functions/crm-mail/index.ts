// Entry point of the mail worker: checks the caller (cron with the service key, or the signed-in
// administrator from the app), runs one pass and answers with what happened.
// Context: Supabase Edge Function (Deno). | Input: POST without body. | Output: JSON report.
import { SERVICE_KEY, SUPABASE_URL } from "./env.ts";
import { run } from "./worker.ts";

const ALLOWED_ORIGINS = ["https://crm.speedofthespirit.dev", "https://repocity-crm.pages.dev", "http://localhost:5173"];

// The gateway has already verified the signature (Verify JWT is on), so reading the role is safe.
function jwtRole(token: string): string {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return String((JSON.parse(atob(payload)) as { role?: unknown }).role ?? "");
  } catch {
    return "";
  }
}

async function authorised(request: Request): Promise<boolean> {
  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (token === "") return false;
  if (token === SERVICE_KEY || jwtRole(token) === "service_role") return true;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: "POST", headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "", Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}",
  });
  return response.ok && (await response.json()) === true;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") ?? "";
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return new Response("Nur POST.", { status: 405, headers: cors });
  if (!(await authorised(request))) return new Response("Kein Zugriff.", { status: 401, headers: cors });
  const report = await run();
  return new Response(JSON.stringify(report), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
});
