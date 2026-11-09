"use client";

import { useState } from "react";
import { Button, inputClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ initialError, next }: { initialError: string | null; next: string | null }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(initialError);

  const callbackUrl = () => {
    const u = new URL("/auth/callback", window.location.origin);
    if (next) u.searchParams.set("next", next);
    return u.toString();
  };

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setState("sending");
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callbackUrl(), shouldCreateUser: true },
    });
    if (error) {
      setError(error.message);
      setState("idle");
    } else {
      setState("sent");
    }
  }

  async function google() {
    setError(null);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });
    if (error) setError(error.message);
  }

  if (state === "sent") {
    return (
      <div className="mt-6 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-900">
        <p className="font-medium">Check your inbox</p>
        <p className="mt-1">
          We sent a sign-in link to <strong>{email}</strong>. Open it in this browser.
        </p>
        <button className="mt-3 text-indigo-700 underline" onClick={() => setState("idle")}>
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <Button variant="secondary" className="w-full" onClick={google} type="button">
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
          <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
          <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.6H2.1v2.9A11 11 0 0 0 12 23z" />
          <path fill="#FBBC05" d="M5.8 14a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 9.9L5.8 14z" />
          <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4z" />
        </svg>
        Continue with Google
      </Button>
      <div className="flex items-center gap-3 text-xs text-slate-400">
        <div className="h-px flex-1 bg-slate-200" /> or <div className="h-px flex-1 bg-slate-200" />
      </div>
      <form onSubmit={sendLink} className="space-y-3">
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          className={inputClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button className="w-full" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Email me a magic link"}
        </Button>
      </form>
      {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    </div>
  );
}
