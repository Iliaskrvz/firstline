// One case study: who, reply rate before and after, three numbers, a quote. Only rendered for entries
// that visibleProof() lets through (src/lib/proof.ts), so placeholders never reach production.
import type { HomeCopy } from "@/content/home";
import type { CaseStudy } from "@/content/proof";
import { fmtInt, type Locale } from "@/content/site";

export function CaseStudyCard({ c, t, locale }: { c: CaseStudy; t: HomeCopy["caseStudy"]; locale: Locale }) {
  const pct = (n: number) => `${n.toLocaleString(locale === "nl" ? "nl-NL" : "en-US", { maximumFractionDigits: 1 })}%`;
  return (
    <figure className={`relative overflow-hidden rounded-3xl bg-white p-6 ring-1 sm:p-8 ${c.placeholder ? "ring-2 ring-amber-400" : "ring-slate-200"}`}>
      {c.placeholder && <p className="mb-4 inline-block rounded-md bg-amber-100 px-2 py-1 font-mono text-[12px] text-amber-900">{t.placeholder}</p>}
      <p className="font-mono text-[12px] text-slate-600">
        {c.who}
        {c.company ? ` · ${c.company}` : ""}
      </p>
      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs text-slate-600">{t.before}</p>
            <p className="font-display mt-1 text-[40px] leading-none text-slate-500">{pct(c.before.replyRate)}</p>
            <p className="mt-2 text-xs text-slate-500">{t.basedOn(fmtInt(c.before.emails, locale))}</p>
          </div>
          <div className="rounded-2xl bg-brand-50 p-4">
            <p className="text-xs text-brand-900">{t.after}</p>
            <p className="font-display mt-1 text-[40px] leading-none text-brand-900">{pct(c.after.replyRate)}</p>
            <p className="mt-2 text-xs text-brand-900/80">{t.basedOn(fmtInt(c.after.emails, locale))}</p>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-3">
          {c.numbers.map((x) => (
            <div key={x.label} className="border-t border-slate-200 pt-3">
              <dt className="sr-only">{x.label}</dt>
              <dd>
                <span className="font-display block text-[32px] leading-none">{x.value}</span>
                <span className="mt-1 block text-xs text-slate-600">{x.label}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <blockquote className="font-display mt-6 border-l-2 border-brand-600 pl-4 text-[20px] leading-snug text-slate-900">&ldquo;{c.quote}&rdquo;</blockquote>
      <figcaption className="mt-2 pl-4 text-sm text-slate-600">{c.quoteBy}</figcaption>
    </figure>
  );
}
