"use client";

// "Talk to us" on /agencies. Posts to /api/contact.
import { useState } from "react";
import { useTurnstile } from "@/components/marketing/turnstile";
import { buttonClass, inputClass } from "@/components/ui";
import { AGENCIES } from "@/content/agencies";

const T = AGENCIES.form;

export function ContactForm({ siteKey }: { siteKey: string | null }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const ts = useTurnstile(siteKey);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await fetch("/api/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...data, token: ts.token }) });
      const j = await res.json().catch(() => ({ error: T.errors.generic }));
      if (res.ok) setSent(true);
      else setError({ text: j.error ?? T.errors.generic, field: j.field });
    } catch {
      setError({ text: T.errors.network });
    } finally {
      setBusy(false);
      ts.reset();
    }
  }

  if (sent)
    return (
      <p className="rounded-2xl bg-emerald-50 p-6 text-emerald-900 ring-1 ring-emerald-200" role="status">
        {T.sent}
      </p>
    );

  const invalid = (f: string) => (error?.field === f ? { "aria-invalid": true, "aria-describedby": "contact-error" } : {});
  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-6 ring-1 ring-slate-200" noValidate>
      {ts.script}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-800">{T.name}</span>
          <input name="name" className={`${inputClass} mt-1.5`} required maxLength={120} autoComplete="name" {...invalid("name")} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-800">{T.email}</span>
          <input name="email" type="email" className={`${inputClass} mt-1.5`} required maxLength={254} autoComplete="email" {...invalid("email")} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-800">{T.company}</span>
          <input name="company" className={`${inputClass} mt-1.5`} maxLength={160} autoComplete="organization" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-800">{T.volume}</span>
          <select name="volume" className={`${inputClass} mt-1.5`} required defaultValue="" {...invalid("volume")}>
            <option value="" disabled>
              {T.volumePlaceholder}
            </option>
            {T.volumes.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-sm font-medium text-slate-800">{T.message}</span>
        <textarea name="message" rows={4} maxLength={4000} className={`${inputClass} mt-1.5 h-auto py-2`} placeholder={T.messagePlaceholder} />
      </label>
      {/* Hidden from people; bots that fill it in are dropped. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {ts.widget}
      {error && (
        <p id="contact-error" className="text-sm text-rose-800" role="alert">
          {error.text}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className={buttonClass("accent", "rounded-full px-6 py-3 text-[15px]")} disabled={busy || (ts.needed && !ts.token)}>
          {busy ? T.sending : T.submit}
        </button>
        <p className="text-xs text-slate-600">{T.privacy}</p>
      </div>
    </form>
  );
}
