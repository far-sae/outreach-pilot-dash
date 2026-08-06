import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/store/auth-store";

/**
 * Where the emailed recovery link lands.
 *
 * Clicking the link gives the browser a recovery session (the Supabase client
 * reads it from the URL hash), so by the time this renders the user is
 * authenticated and updateUser({ password }) is allowed. The route sits
 * outside the auth gate — behind it, an expired link would show the sign-in
 * screen instead of an explanation.
 */
export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [{ title: "Reset password" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { session, loading, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }

    setBusy(true);
    setError(null);
    const { error: err } = await updatePassword(password);
    setBusy(false);

    if (err) {
      setError(err);
      return;
    }
    toast.success("Password updated");
    // The recovery session is a full session, so the app opens signed in.
    void navigate({ to: "/" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Reset password</h1>

        {loading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : !session ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              This reset link is invalid or has expired. Request a new one from the sign-in screen
              with &ldquo;Forgot password?&rdquo;.
            </p>
            <div className="mt-6">
              <a
                href="/"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Back to sign in
              </a>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose a new password for {session.user.email}.
            </p>

            <form onSubmit={onSubmit} className="mt-8 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Same password again"
                />
              </div>

              {error ? <p className="text-sm text-destructive">{error}</p> : null}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Working…" : "Set new password"}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
