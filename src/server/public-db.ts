import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env["VITE_SUPABASE_URL"];
const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

/**
 * Unauthenticated client for the tracking and unsubscribe callbacks. Recipients
 * have no session, so these run as the `anon` role and can only reach the two
 * security-definer functions that were explicitly granted to it.
 */
export function anonClient(): SupabaseClient {
  if (!url || !key) throw new Error("Supabase is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tokens come from a URL, so reject anything that is not a uuid before querying. */
export const isToken = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
