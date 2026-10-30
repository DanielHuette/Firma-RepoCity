// Single Supabase client for the app; it talks to the cockpit schema by default and reads the
// other RepoCity apps through their own schemas.
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";

const config = supabaseConfig();
if (config === null) throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set at build time");

// A password reset link marks the address; it is read before the client consumes the address.
export const recoveryRequested = window.location.hash.includes("type=recovery");

export const supabase = createClient(config.url, config.anonKey, { db: { schema: "cockpit" } });
