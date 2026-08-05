import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

/**
 * Unsubscribe endpoint.
 *
 * POST does the work, so that RFC 8058 One-Click (what Gmail's unsubscribe
 * button sends) works directly. GET renders a confirmation page instead of
 * unsubscribing, because mail clients and security scanners routinely prefetch
 * links — doing it on GET would unsubscribe people who never clicked.
 */
export const Route = createFileRoute("/u/$token")({
  server: {
    handlers: {
      POST: async ({ params }) => {
        try {
          const { anonClient, isToken } = await import("@/server/public-db");
          if (!isToken(params.token)) {
            return Response.json({ ok: false, error: "Invalid link" }, { status: 400 });
          }
          const { data, error } = await anonClient().rpc("record_unsubscribe", {
            p_token: params.token,
          });
          if (error) throw new Error(error.message);
          if (data !== true) {
            return Response.json(
              { ok: false, error: "This link is no longer valid." },
              {
                status: 404,
              },
            );
          }
          return Response.json({ ok: true });
        } catch (err) {
          console.error("unsubscribe failed:", err);
          return Response.json({ ok: false, error: "Something went wrong." }, { status: 500 });
        }
      },
    },
  },
  head: () => ({
    meta: [
      { title: "Unsubscribe" },
      // Keep these out of search results.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const { token } = Route.useParams();
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function confirm() {
    setState("working");
    try {
      const res = await fetch(`/u/${token}`, { method: "POST" });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (body.ok) {
        setState("done");
      } else {
        setState("error");
        setMessage(body.error ?? "Something went wrong.");
      }
    } catch {
      setState("error");
      setMessage("Could not reach the server. Try again in a moment.");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border p-8 text-center">
        {state === "done" ? (
          <>
            <h1 className="text-xl font-semibold text-foreground">You're unsubscribed</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              You won't receive any further emails from us. You can close this page.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-foreground">Unsubscribe</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Confirm below and we'll stop emailing you.
            </p>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={state === "working"}
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {state === "working" ? "Working…" : "Unsubscribe me"}
            </button>
            {state === "error" && <p className="mt-4 text-sm text-destructive">{message}</p>}
          </>
        )}
      </div>
    </div>
  );
}
