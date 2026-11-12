"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Button, inputClass } from "@/components/ui";
import { friendlyAuthError, noSubscribe, passkeysSupported, passkeysSupportedOnServer } from "@/lib/auth-messages";
import type { SignInOptions } from "@/lib/auth-options";
import { createClient } from "@/lib/supabase/client";

export function GoogleButton({ next, onError }: { next: string | null; onError: (m: string) => void }) {
  async function google() {
    const u = new URL("/auth/callback", window.location.origin);
    if (next) u.searchParams.set("next", next);
    const { error } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: u.toString() } });
    if (error) onError(friendlyAuthError(error));
  }
  return (
    <Button variant="secondary" className="w-full" onClick={google} type="button">
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
        <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
        <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.6H2.1v2.9A11 11 0 0 0 12 23z" />
        <path fill="#FBBC05" d="M5.8 14a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 9.9L5.8 14z" />
        <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4z" />
      </svg>
      Continue with Google
    </Button>
  );
}

export function Divider() {
  return (
    <div className="flex items-center gap-3 text-xs text-slate-400">
      <div className="h-px flex-1 bg-slate-200" /> or <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/campaigns");

export function LoginForm({ initialError, next, options }: { initialError: string | null; next: string | null; options: SignInOptions }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "link">("password");
  const [state, setState] = useState<"idle" | "busy" | "link-sent" | "unconfirmed">("idle");
  const [error, setError] = useState<string | null>(initialError);
  const passkeys = useSyncExternalStore(noSubscribe, passkeysSupported, passkeysSupportedOnServer) && options.passkeys;

  const callbackUrl = () => {
    const u = new URL("/auth/callback", window.location.origin);
    if (next) u.searchParams.set("next", next);
    return u.toString();
  };
  const done = () => {
    router.replace(safeNext(next));
    router.refresh();
  };

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setState("busy");
    const supabase = createClient();
    if (mode === "link") {
      const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: callbackUrl(), shouldCreateUser: true } });
      if (error) {
        setError(friendlyAuthError(error));
        setState("idle");
      } else setState("link-sent");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(friendlyAuthError(error));
      setState(error.code === "email_not_confirmed" ? "unconfirmed" : "idle");
      return;
    }
    done();
  }

  async function passkey() {
    setError(null);
    setState("busy");
    const { error } = await createClient().auth.signInWithPasskey();
    if (error) {
      setError(friendlyAuthError(error as { code?: string; message?: string; name?: string }));
      setState("idle");
      return;
    }
    done();
  }

  async function resendConfirmation() {
    setError(null);
    const { error } = await createClient().auth.resend({ type: "signup", email: email.trim(), options: { emailRedirectTo: callbackUrl() } });
    setError(error ? friendlyAuthError(error) : "We sent the confirmation email again. Open the link in it, then sign in.");
  }

  if (state === "link-sent") {
    return (
      <div className="mt-6 rounded-xl bg-brand-50 p-4 text-sm text-brand-900">
        <p className="font-medium">Check your inbox</p>
        <p className="mt-1">
          We sent a sign-in link to <strong>{email}</strong>. Open it in this browser.
        </p>
        <button className="mt-3 text-brand-700 underline" onClick={() => setState("idle")}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {options.google && <GoogleButton next={next} onError={setError} />}
      {passkeys && (
        <Button variant="secondary" className="w-full" onClick={passkey} type="button" disabled={state === "busy"}>
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="9" cy="8" r="4" />
            <path d="M3 21v-1a6 6 0 0 1 9-5.2M17 11a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 6v4m0-2h2" />
          </svg>
          Sign in with a passkey
        </Button>
      )}
      {(options.google || passkeys) && <Divider />}
      <form onSubmit={signIn} className="space-y-3">
        <input
          type="email"
          required
          autoComplete="username webauthn"
          placeholder="you@company.com"
          className={inputClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {mode === "password" && (
          <input
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        <Button className="w-full" disabled={state === "busy"}>
          {state === "busy" ? "One moment…" : mode === "password" ? "Sign in" : "Email me a sign-in link"}
        </Button>
      </form>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button type="button" className="text-brand-700 hover:underline" onClick={() => (setMode(mode === "password" ? "link" : "password"), setError(null))}>
          {mode === "password" ? "Email me a sign-in link instead" : "Use my password instead"}
        </button>
        {mode === "password" && (
          <Link href="/forgot-password" className="text-slate-600 hover:underline">
            Forgot password?
          </Link>
        )}
      </div>
      {error && (
        <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          {error}
          {state === "unconfirmed" && (
            <button type="button" className="ml-1 underline" onClick={resendConfirmation}>
              Send it again
            </button>
          )}
        </div>
      )}
      <p className="text-center text-sm text-slate-600">
        New here?{" "}
        <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="font-medium text-brand-700 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
