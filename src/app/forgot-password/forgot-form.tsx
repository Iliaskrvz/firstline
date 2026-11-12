"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, inputClass } from "@/components/ui";
import { friendlyAuthError } from "@/lib/auth-messages";
import { createClient } from "@/lib/supabase/client";

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setState("busy");
    const u = new URL("/auth/callback", window.location.origin);
    u.searchParams.set("next", "/settings/account?reset=1");
    const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: u.toString() });
    if (error && !error.code?.startsWith("user_")) {
      setError(friendlyAuthError(error));
      setState("idle");
      return;
    }
    setState("sent"); // same answer whether or not the address has an account
  }

  if (state === "sent") {
    return (
      <div className="mt-6 rounded-xl bg-brand-50 p-4 text-sm text-brand-900">
        If <strong>{email}</strong> has an account, a reset link is on its way. Open it in this browser to choose a new password.
      </div>
    );
  }
  return (
    <form onSubmit={send} className="mt-6 space-y-3">
      <input type="email" required autoComplete="email" placeholder="you@company.com" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
      <Button className="w-full" disabled={state === "busy"}>
        {state === "busy" ? "Sending…" : "Send reset link"}
      </Button>
      {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <p className="text-center text-sm">
        <Link href="/login" className="text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
