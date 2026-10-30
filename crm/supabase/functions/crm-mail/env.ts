// Access to the Supabase project, read from the Edge Function environment.

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
export const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Legacy service keys are JWTs and go into Authorization as well; the newer secret keys
// (sb_secret_...) are accepted in the apikey header alone.
export const SERVICE_HEADERS: Record<string, string> = SERVICE_KEY.startsWith("eyJ")
  ? { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } : { apikey: SERVICE_KEY };
