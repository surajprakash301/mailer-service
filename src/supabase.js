import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { config } from "./config.js";

/**
 * Server-side Supabase client for the Express mailer.
 * Prefer SUPABASE_* vars; NEXT_PUBLIC_* accepted for dashboard copy-paste.
 * Pass `ws` so realtime bootstrap does not crash on hosts without native WebSocket.
 */
export function createSupabaseClient() {
  const url = config.supabaseUrl;
  const key = config.supabaseServiceRoleKey || config.supabasePublishableKey;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or SUPABASE_SERVICE_ROLE_KEY) in .env",
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      transport: ws,
    },
    global: {
      headers: { "X-Client-Info": "loky-mailer" },
    },
  });
}

let cached = null;

/** Lazy singleton for routes / cron / store. */
export function getSupabase() {
  if (!cached) cached = createSupabaseClient();
  return cached;
}

export function isSupabaseConfigured() {
  return Boolean(config.supabaseUrl && (config.supabaseServiceRoleKey || config.supabasePublishableKey));
}
