import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Bracket access rather than dot access: tsconfig sets
// `noPropertyAccessFromIndexSignature`, and these keys are not part of Vite's
// built-in ImportMetaEnv.
const url = import.meta.env["VITE_SUPABASE_URL"];
const publishableKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

/**
 * False until both env vars are present. The UI checks this so a missing .env
 * shows setup instructions instead of a blank screen or a crash.
 */
export const isSupabaseConfigured = Boolean(url && publishableKey);

// A dummy client is created when env vars are absent so importing this module
// never throws — the app gates on `isSupabaseConfigured` before using it.
export const supabase: SupabaseClient = createClient(
  url ?? "http://localhost:54321",
  publishableKey ?? "public-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
