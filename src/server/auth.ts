import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { getRequestHeader } from "@tanstack/react-start/server";

const url = import.meta.env["VITE_SUPABASE_URL"];
const publishableKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

/**
 * Identifies the caller of a server function and returns a Supabase client
 * bound to their token, so every query still runs under row level security.
 *
 * Server functions are reachable independently of the UI that calls them, so
 * this must run inside every handler that touches user data — a route guard is
 * not a security boundary.
 */
export async function requireUser(): Promise<{ client: SupabaseClient; user: User }> {
  if (!url || !publishableKey) {
    throw new Error("Supabase is not configured on the server.");
  }

  const header = getRequestHeader("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new Error("You are not signed in.");

  const client = createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    // A per-request client must never touch persisted session state.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Verifies the token's signature with Supabase rather than trusting its claims.
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("Your session has expired — sign in again.");

  return { client, user: data.user };
}
