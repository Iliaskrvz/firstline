"use client";

// The /calculator tool. Runs in the browser; the volume is kept in the address (?emails=300) so a
// comparison can be shared as a link.
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { Pack } from "@/config/packs";
import { CALCULATOR as T } from "@/content/calculator";
import { COMPARE } from "@/content/compare";
import type { Competitor } from "@/content/competitors";
import { competitorCost, firstLineCost } from "@/lib/price-compare";

const MAX = 50_000;
const eur = (n: number, digits = 2) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
const int = (n: number) => n.toLocaleString("en-US");
const clamp = (n: number) => Math.min(MAX, Math.max(1, Math.round(n || 0)));

type Props = { packs: Pack[]; competitors: Competitor[] };

/** The calculator, starting from ?emails= when the link has one (300 otherwise). */
export function Calculator(props: Props) {
  return (
    <Suspense fallback={<CalculatorBody {...props} initial={300} />}>
      <FromUrl {...props} />
    </Suspense>
  );
}

function FromUrl(props: Props) {
  const v = Number(useSearchParams().get("emails"));
  const initial = v > 0 ? clamp(v) : 300;
  return <CalculatorBody {...props} initial={initial} />;
}

function CalculatorBody({ packs, competitors, initial }: Props & { initial: number }) {
  const [emails, setEmails] = useState(initial);
  const [copied, setCopied] = useState(false);

  const set = (n: number) => {
    const v = clamp(n);
    setEmails(v);
    setCopied(false);
    const url = new URL(window.location.href);
    url.searchParams.set("emails", String(v));
    window.history.replaceState(null, "", url);
  };

  const fl = firstLineCost(emails, packs);
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
        <label htmlFor="emails" className="text-sm font-medium text-slate-800">
          {T.inputLabel}
        </label>
        <input
          id="emails"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX}
          value={emails}
          onChange={(e) => set(Number(e.target.value))}
          className="font-display mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-[36px] leading-none tabular-nums focus:border-brand-600 focus:outline-none"
        />
        <input
          type="range"
          min={50}
          max={20_000}
          step={50}
          value={Math.min(emails, 20_000)}
          onChange={(e) => set(Number(e.target.value))}
          className="mt-5 w-full accent-brand-700"
          aria-label={T.inputLabel}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          {T.presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => set(p)}
              aria-pressed={emails === p}
              className={`rounded-full px-3 py-1 text-sm ring-1 ${emails === p ? "bg-slate-950 text-white ring-slate-950" : "bg-white text-slate-700 ring-slate-300 hover:ring-slate-500"}`}
            >
              {int(p)}
            </button>
          ))}
        </div>
        <div className="mt-6 rounded-xl bg-brand-50 p-4">
          <p className="text-sm text-brand-900">{T.firstLine}</p>
          <p className="font-display mt-1 text-[44px] leading-none text-brand-950 tabular-nums">
            {eur(fl.monthly)}
            <span className="text-lg text-brand-900">{COMPARE.perMonth}</span>
          </p>
          <p className="mt-2 text-sm text-brand-900">{T.firstLineDetail(eur(fl.perEmail, 3), fl.pack.name)}</p>
          <p className="mt-1 text-sm text-brand-900/80">{T.yearly(eur(fl.monthly * 12))}</p>
        </div>
        <button type="button" onClick={copy} className="mt-4 text-sm font-medium text-brand-800 underline decoration-brand-200 underline-offset-2">
          {copied ? T.copied : T.copy}
        </button>
      </div>

      <div className="min-w-0">
        <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200" aria-live="polite">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">{T.tool}</th>
                <th className="px-4 py-3 font-medium">{T.monthly}</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">{T.difference}</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-t border-slate-100 bg-brand-50/50">
                <th scope="row" className="px-4 py-3 font-semibold">
                  FirstLine
                </th>
                <td className="px-4 py-3 font-semibold tabular-nums">{eur(fl.monthly)}</td>
                <td className="hidden px-4 py-3 sm:table-cell" />
              </tr>
              {competitors.map((c) => {
                const k = competitorCost(c, emails);
                let price: React.ReactNode;
                let diff: string | null = null;
                if (k.kind === "unknown") price = <span className="text-slate-500">{COMPARE.unknown[k.why]}</span>;
                else if (k.kind === "price") {
                  price = (
                    <>
                      <span className="font-semibold tabular-nums">
                        {k.currency}
                        {k.price}
                      </span>
                      <span className="block text-xs text-slate-500">{k.plan}</span>
                    </>
                  );
                  diff = k.price >= fl.monthly ? T.more(`${k.currency}${int(Math.round(k.price - fl.monthly))}`) : T.less(`${k.currency}${int(Math.round(fl.monthly - k.price))}`);
                } else {
                  price = (
                    <>
                      <span className="font-semibold tabular-nums">
                        {k.currency}
                        {k.low.price}–{k.high.price}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {COMPARE.rangePlans(k.low.plan, k.high.plan)}
                      </span>
                    </>
                  );
                }
                return (
                  <tr key={c.id} className="border-t border-slate-100">
                    <th scope="row" className="px-4 py-3 font-semibold">
                      <a href={c.source} target="_blank" rel="noopener nofollow" className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900">
                        {c.name}
                      </a>
                    </th>
                    <td className="px-4 py-3">{price}</td>
                    <td className="hidden px-4 py-3 text-slate-600 sm:table-cell">{diff}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-slate-600">{T.rangeNote}</p>
        <p className="mt-2 text-sm text-slate-600">{T.note}</p>
      </div>
    </div>
  );
}
