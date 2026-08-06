import { useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useAuth } from "@/store/auth-store";

/**
 * Renders the sign-in screen until there is a session, then the app.
 * Sits inside the root route, so no individual route needs a guard.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

  if (!isSupabaseConfigured) return <SetupNotice />;
  if (loading) return <Splash />;
  if (!session) return <SignInScreen />;
  return <>{children}</>;
}

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}

function SetupNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg rounded-xl border border-border p-8">
        <h1 className="text-xl font-semibold text-foreground">Connect your database</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Create a <code className="font-mono text-xs">.env</code> file in the project root with
          your Supabase credentials, then restart the dev server.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed text-foreground">
          {`VITE_SUPABASE_URL="https://<project-ref>.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_..."`}
        </pre>
        <p className="mt-4 text-sm text-muted-foreground">
          Both values are in your Supabase dashboard under Project settings → API keys.
        </p>
      </div>
    </div>
  );
}

/**
 * Supabase returns terse API strings. Translate the ones a user can actually
 * act on, and pass anything else through untouched.
 */
function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();

  if (m.includes("rate limit")) {
    return (
      "Supabase's built-in email limit was hit. Confirmation emails are still " +
      "switched on — turn off Authentication → Sign In / Providers → Email → " +
      "Confirm email, and sign-ups will work instantly without sending any email."
    );
  }
  if (m.includes("invalid login credentials")) {
    return "That email and password combination doesn't match an account.";
  }
  if (m.includes("email not confirmed")) {
    return "This account still needs confirming. Check your inbox, or turn off Confirm email in your Supabase auth settings.";
  }
  if (m.includes("already registered") || m.includes("already been registered")) {
    return "An account with that email already exists — switch to Sign in instead.";
  }
  if (m.includes("password should be")) {
    return "Password is too short — use at least 6 characters.";
  }
  return message;
}

function SignInScreen() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchMode(next: "signin" | "signup" | "forgot") {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    if (mode === "signin") {
      const { error: err } = await signIn(email, password);
      if (err) setError(friendlyAuthError(err));
    } else if (mode === "signup") {
      const { error: err, needsEmail } = await signUp(email, password);
      if (err) setError(friendlyAuthError(err));
      else if (needsEmail) setNotice("Check your inbox for a confirmation link, then sign in.");
    } else {
      const { error: err } = await resetPassword(email);
      if (err) setError(friendlyAuthError(err));
      // Same wording either way, so the form can't be used to probe which
      // emails have an account.
      else setNotice("If an account exists for that email, a reset link is on its way.");
    }

    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Outreach Console</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "signin"
            ? "Sign in to your account."
            : mode === "signup"
              ? "Create an account to get started."
              : "Enter your email and we'll send you a reset link."}
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          {mode !== "forgot" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {mode === "signin" ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:underline"
                    onClick={() => switchMode("forgot")}
                  >
                    Forgot password?
                  </button>
                ) : null}
              </div>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
              />
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {notice ? <p className="text-sm text-foreground">{notice}</p> : null}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy
              ? "Working…"
              : mode === "signin"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : "Send reset link"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "signin" ? "No account yet?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "Create one" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
