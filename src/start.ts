import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachAuth } from "@/lib/auth-middleware";

// Nothing here may import from "@tanstack/react-start/server" at module scope.
// The server core loads this file to build its handler, so such an import forms
// a cycle: the bundled build then evaluates this module before the framework's
// exports are initialised, and createCsrfMiddleware is undefined at call time.
const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
//
// The call is deferred into the createStart factory: calling it at module
// scope crashes the Nitro (Vercel) bundle, where this module evaluates before
// the framework's exports are initialised — same cycle as the import note
// above, just at call time instead of import time.
let csrfMiddleware: ReturnType<typeof createCsrfMiddleware> | undefined;

export const startInstance = createStart(() => ({
  // Without this the server cannot identify the caller of a server function:
  // the Supabase session lives in browser storage, not in a cookie.
  functionMiddleware: [attachAuth],
  requestMiddleware: [
    errorMiddleware,
    (csrfMiddleware ??= createCsrfMiddleware({
      filter: (ctx) => ctx.handlerType === "serverFn",
    })),
  ],
}));
