"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, inputClass } from "@/components/ui";
import { friendlyAuthError, MIN_PASSWORD, passwordProblem } from "@/lib/auth-messages";
import { createClient } from "@/lib/supabase/client";
import { Divider, GoogleButton } from "../login/login-form";

export function SignupForm({ next, google }: { next: string | null; google: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const problem = password ? passwordProblem(password, email) : null;

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    const p = passwordProblem(password, email);
    if (p) return setError(p);
    setError(null);
    setState("busy");
    const u = new URL("/auth/callback", window.location.origin);
    if (next) u.searchParams.set("next", next);
    const { error } = await createClient().auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: u.toString() } });
    // An existing address gets the same answer, so nobody can find out who has an account.
    if (error && error.code !== "user_already_exists") {
      setError(friendlyAuthError(error));
      setState("idle");
      return;
    }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div className="mt-6 rounded-xl bg-brand-50 p-4 text-sm text-brand-900">
        <p className="font-medium">Confirm your email address</p>
        <p className="mt-1">
          We sent a link to <strong>{email}</strong>. Open it to finish creating your account, then sign in with your password. Tip: add a passkey later in
          Settings → Account to sign in without a password.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {google && (
        <>
          <GoogleButton next={next} onError={setError} />
          <Divider />
        </>
      )}
      <form onSubmit={signUp} className="space-y-3">
        <input type="email" required autoComplete="email" placeholder="you@company.com" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
        <div>
          <input
            type="password"
            required
            autoComplete="new-password"
            placeholder={`Password (at least ${MIN_PASSWORD} characters)`}
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {problem && <p className="mt-1 text-xs text-slate-500">{problem}</p>}
        </div>
        <Button className="w-full" disabled={state === "busy" || !!problem}>
          {state === "busy" ? "One moment…" : "Create account"}
        </Button>
      </form>
      {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <p className="text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="font-medium text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
