import { createMiddleware } from "@tanstack/react-start";

import { supabase } from "@/lib/supabase";

/**
 * Attaches the caller's Supabase access token to every server function request.
 * Registered globally in src/start.ts — without it the server has no way to tell
 * who is calling, since the session lives in browser storage.
 */
export const attachAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
});
