"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTurnstile } from "@/components/marketing/turnstile";
import { track } from "@/lib/track";
import { buttonClass, inputClass } from "@/components/ui";
import type { HomeCopy } from "@/content/home";
import type { Locale } from "@/content/site";

type Source = { n: number; id: string; text: string; url: string };
type Result =
  | { status: "done"; domain: string; opener: string; sources: Source[]; cached: boolean }
  | { status: "no_facts" | "failed" | "timeout"; domain: string; reason: string; cached?: boolean };

/** The homepage demo box. In test mode (local only) there's no captcha and the result is test output. */
export function LiveDemo({ t: T, lang, siteKey, test }: { t: HomeCopy["liveDemo"]; lang: Locale; siteKey: string | null; test: boolean }) {
  const [url, setUrl] = useState("");
  const [sells, setSells] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const ts = useTurnstile(test ? null : siteKey);
  const token = ts.token;
  const steps = T.working.length;

  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => setStep((s) => Math.min(s + 1, steps - 1)), 4000);
    return () => window.clearInterval(t);
  }, [busy, steps]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setStep(0);
    setBusy(true);
    try {
      const res = await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, sells, token, lang }) });
      const j = await res.json().catch(() => ({ error: T.errorGeneric }));
      if (!res.ok) setError(j.error ?? T.errorGeneric);
      else {
        setResult(j as Result);
        track("Demo used", { status: (j as Result).status, lang, cached: !!(j as Result).cached });
      }
    } catch {
      setError(T.errorNetwork);
    } finally {
      setBusy(false);
      ts.reset();
    }
  }

  const needsToken = ts.needed;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
      {ts.script}
      <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-6 ring-1 ring-slate-200">
        <label className="block">
          <span className="text-sm font-medium text-slate-800">{T.urlLabel}</span>
          <input
            className={`${inputClass} mt-1.5`}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={T.urlPlaceholder}
            required
            maxLength={300}
            inputMode="url"
            autoComplete="url"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-800">{T.sellsLabel}</span>
          <input className={`${inputClass} mt-1.5`} value={sells} onChange={(e) => setSells(e.target.value)} placeholder={T.sellsPlaceholder} maxLength={140} />
        </label>
        {ts.widget}
        <button type="submit" className={buttonClass("accent", "w-full rounded-full py-3 text-[15px]")} disabled={busy || !url.trim() || (needsToken && !token)}>
          {busy ? T.working[step] : T.submit}
        </button>
        <p className="text-xs leading-relaxed text-slate-600">{test ? T.testNote : T.limitNote}</p>
      </form>

      <div className="min-h-[220px] rounded-2xl border border-dashed border-slate-300 p-6" aria-live="polite">
        {!result && !error && !busy && <p className="font-mono text-[12px] text-slate-600">{T.resultLabel.replace("{domain}", "…")}</p>}
        {busy && (
          <ol className="space-y-2 font-mono text-[13px] text-slate-700">
            {T.working.map((w, i) => (
              <li key={w} className={i <= step ? "text-slate-900" : "text-slate-400"}>
                <span className="text-brand-700">[{i + 1}]</span> {w}
              </li>
            ))}
          </ol>
        )}
        {error && <p className="text-[15px] text-rose-800">{error}</p>}
        {result?.status === "done" && (
          <div>
            <p className="font-mono text-[12px] text-slate-600">{T.resultLabel.replace("{domain}", result.domain)}</p>
            <p className="font-display mt-3 text-[22px] leading-snug text-slate-900">
              {result.opener}
              {result.sources.map((s) => (
                <span key={s.n} className="cite ml-0.5 align-super text-[0.6em]">
                  [{s.n}]
                </span>
              ))}
            </p>
            {result.sources.length > 0 && (
              <ul className="mt-4 space-y-1.5 border-t border-dashed border-slate-200 pt-3 font-mono text-[12px] text-slate-700">
                {result.sources.map((s) => (
                  <li key={s.n}>
                    <span className="text-brand-700">[{s.n}]</span> &ldquo;{s.text}&rdquo; ·{" "}
                    <a href={s.url} target="_blank" rel="noopener nofollow" className="underline decoration-slate-300 underline-offset-2">
                      {s.url.replace(/^https?:\/\//, "")}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {result.cached && <p className="mt-3 text-xs text-slate-600">{T.cachedNote}</p>}
          </div>
        )}
        {result && result.status !== "done" && <p className="text-[15px] text-slate-800">{result.reason}</p>}
        {result && (
          <Link href={`/signup?demo=${encodeURIComponent(result.domain)}`} className={buttonClass("primary", "mt-6 rounded-full px-5 py-2.5")}>
            {T.cta} <span aria-hidden>›</span>
          </Link>
        )}
      </div>
    </div>
  );
}
