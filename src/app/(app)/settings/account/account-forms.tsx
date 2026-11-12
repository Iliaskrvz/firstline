"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Button, inputClass } from "@/components/ui";
import { friendlyAuthError, MIN_PASSWORD, noSubscribe, passkeysSupported, passkeysSupportedOnServer, passwordProblem } from "@/lib/auth-messages";
import { createClient } from "@/lib/supabase/client";

export function PasswordForm({ email, highlight }: { email: string; highlight: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = password ? passwordProblem(password, email) : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (problem) return;
    if (password !== again) return setMsg({ ok: false, text: "The two passwords don't match." });
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: friendlyAuthError(error) });
    setPassword("");
    setAgain("");
    setMsg({ ok: true, text: "Password saved. Use it next time with your email address." });
    if (highlight) router.replace("/settings/account");
  }

  return (
    <form onSubmit={save} className={`space-y-2 ${highlight ? "rounded-lg ring-2 ring-indigo-200 p-3" : ""}`}>
      <input
        type="password"
        autoComplete="new-password"
        placeholder={`New password (at least ${MIN_PASSWORD} characters)`}
        className={inputClass}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {problem && <p className="text-xs text-slate-500">{problem}</p>}
      <input type="password" autoComplete="new-password" placeholder="Same password again" className={inputClass} value={again} onChange={(e) => setAgain(e.target.value)} />
      <Button type="submit" disabled={busy || !password || !!problem}>
        {busy ? "Saving…" : "Save password"}
      </Button>
      {msg && <p className={msg.ok ? "text-sm text-emerald-700" : "text-sm text-rose-700"}>{msg.text}</p>}
    </form>
  );
}

type Passkey = { id: string; friendly_name?: string; created_at: string; last_used_at?: string };
const fmt = (iso?: string) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)) : "never");

export function PasskeyList() {
  const [list, setList] = useState<Passkey[] | null>(null);
  const supported = useSyncExternalStore(noSubscribe, passkeysSupported, passkeysSupportedOnServer);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    createClient()
      .auth.passkey.list()
      .then(({ data, error }) => {
        if (!alive) return;
        setList(error ? [] : (data ?? []));
        if (error) setMsg({ ok: false, text: friendlyAuthError(error) });
      });
    return () => {
      alive = false;
    };
  }, [version]);

  async function add() {
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().auth.registerPasskey();
    setBusy(false);
    if (error) return setMsg({ ok: false, text: friendlyAuthError(error as { code?: string; message?: string; name?: string }) });
    setMsg({ ok: true, text: "Passkey added. Next time choose “Sign in with a passkey”." });
    load();
  }

  async function remove(p: Passkey) {
    if (!confirm(`Remove the passkey “${p.friendly_name ?? "Passkey"}”? You can't sign in with it any more.`)) return;
    const { error } = await createClient().auth.passkey.delete({ passkeyId: p.id });
    if (error) return setMsg({ ok: false, text: friendlyAuthError(error) });
    load();
  }

  return (
    <div className="space-y-3">
      {list === null ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-slate-500">No passkeys yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {list.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium text-slate-900">{p.friendly_name || "Passkey"}</span>
                <span className="block text-xs text-slate-500">
                  Added {fmt(p.created_at)} · last used {fmt(p.last_used_at)}
                </span>
              </span>
              <Button variant="ghost" onClick={() => remove(p)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {supported ? (
        <Button variant="secondary" onClick={add} disabled={busy}>
          {busy ? "Waiting for your device…" : "Add a passkey"}
        </Button>
      ) : (
        <p className="text-sm text-slate-500">This browser doesn&apos;t support passkeys.</p>
      )}
      {msg && <p className={msg.ok ? "text-sm text-emerald-700" : "text-sm text-rose-700"}>{msg.text}</p>}
    </div>
  );
}
