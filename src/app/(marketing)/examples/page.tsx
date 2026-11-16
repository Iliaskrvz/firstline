// /examples: real openers by industry. Hidden (404) until SHOW_PROOF is on and there are real entries
// in src/content/examples.ts; placeholders only show in local preview (SHOW_PROOF=preview).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CtaBand, Eyebrow, H1, MarketingShell, Section } from "@/components/marketing/site";
import { EXAMPLES, EXAMPLES_PAGE as T } from "@/content/examples";
import { marketingMetadata } from "@/content/meta";
import { visibleProof } from "@/lib/proof";

export const metadata: Metadata = { ...marketingMetadata("examples", "/examples"), robots: { index: false } };

export default function ExamplesPage() {
  const list = visibleProof(EXAMPLES);
  if (!list.length) notFound();
  const industries = [...new Set(list.map((e) => e.industry))];
  const anchor = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <MarketingShell locale="en">
      <Section className="pb-6 md:pb-8">
        <Eyebrow n={1}>{T.eyebrow}</Eyebrow>
        <H1 className="mt-3">{T.title}</H1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-700">{T.intro}</p>
        <nav aria-label={T.industries} className="mt-6 flex flex-wrap gap-2">
          {industries.map((i) => (
            <a key={i} href={`#${anchor(i)}`} className="rounded-full bg-white px-3 py-1 text-sm text-slate-700 ring-1 ring-slate-300 hover:ring-slate-500">
              {i}
            </a>
          ))}
        </nav>
      </Section>
      {industries.map((ind) => (
        <Section key={ind} id={anchor(ind)} className="pt-4 md:pt-6">
          <h2 className="font-display text-[28px] font-medium">{ind}</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {list
              .filter((e) => e.industry === ind)
              .map((e, k) => (
                <figure key={k} lang={e.language} className={`rounded-2xl bg-white p-5 ring-1 ${e.placeholder ? "ring-2 ring-amber-400" : "ring-slate-200"}`}>
                  {e.placeholder && <p className="mb-3 inline-block rounded-md bg-amber-100 px-2 py-1 font-mono text-[12px] text-amber-900">{T.placeholder}</p>}
                  <p className="font-mono text-[12px] text-slate-600">
                    {e.site} · {T.sells}: {e.sells}
                  </p>
                  <blockquote className="font-display mt-3 text-[20px] leading-snug text-slate-900">
                    {e.opener}
                    <span className="cite ml-0.5 align-super text-[0.6em]">[1]</span>
                  </blockquote>
                  <figcaption className="mt-4 border-t border-dashed border-slate-200 pt-3 font-mono text-[12px] text-slate-700">
                    {e.sources.map((s, i) => (
                      <p key={i}>
                        <span className="text-brand-700">[{i + 1}]</span> &ldquo;{s.text}&rdquo; · {s.page}
                      </p>
                    ))}
                  </figcaption>
                </figure>
              ))}
          </div>
        </Section>
      ))}
      <CtaBand title={T.cta.title} sub={T.cta.sub} cta={T.cta.cta} />
    </MarketingShell>
  );
}
