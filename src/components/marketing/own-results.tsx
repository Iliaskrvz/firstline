// "Results from our own outreach": the owner's own numbers with FirstLine. Rendered only when
// visibleProof() lets the entry through (SHOW_PROOF=1 and placeholder: false), so it never shows
// placeholder numbers in production.
import type { HomeCopy } from "@/content/home";
import type { OwnOutreachResult } from "@/content/proof";
import { fmtInt, type Locale } from "@/content/site";

export function OwnResultsCard({
  r,
  t,
  locale,
}: {
  r: OwnOutreachResult;
  t: HomeCopy["ownResults"];
  locale: Locale;
}) {
  const pct = (n: number) =>
    `${n.toLocaleString(locale === "nl" ? "nl-NL" : "en-US", { maximumFractionDigits: 1 })}%`;
  return (
    <figure
      className={`rounded-3xl bg-white p-6 ring-1 sm:p-8 ${r.placeholder ? "ring-2 ring-amber-400" : "ring-slate-200"}`}
    >
      {r.placeholder && (
        <p className="mb-4 inline-block rounded-md bg-amber-100 px-2 py-1 font-mono text-[12px] text-amber-900">
          {t.placeholder}
        </p>
      )}
      <p className="font-display text-[22px] leading-snug text-slate-900">
        {t.title}
      </p>
      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-slate-50 p-4">
          <dt className="text-xs text-slate-600">{t.emailsSent}</dt>
          <dd className="font-display mt-1 text-[36px] leading-none text-slate-900">
            {fmtInt(r.emailsSent, locale)}
          </dd>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <dt className="text-xs text-slate-600">{t.before}</dt>
          <dd className="font-display mt-1 text-[36px] leading-none text-slate-500">
            {pct(r.replyRateBefore)}
          </dd>
        </div>
        <div className="rounded-2xl bg-brand-50 p-4">
          <dt className="text-xs text-brand-900">{t.after}</dt>
          <dd className="font-display mt-1 text-[36px] leading-none text-brand-900">
            {pct(r.replyRateAfter)}
          </dd>
        </div>
      </dl>
      <figcaption className="mt-4 text-sm text-slate-600">
        {t.period(r.period)}
      </figcaption>
    </figure>
  );
}
