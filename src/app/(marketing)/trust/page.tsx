import type { Metadata } from "next";
import Link from "next/link";
import { Check, CtaBand, Eyebrow, H1, MarketingShell, Section } from "@/components/marketing/site";
import { marketingMetadata } from "@/content/meta";
import { TRUST } from "@/content/trust";
import { SUBPROCESSORS } from "@/lib/legal";

export const metadata: Metadata = marketingMetadata("trust", "/trust");

export default function TrustPage() {
  const t = TRUST;
  return (
    <MarketingShell locale="en">
      <Section className="pb-6 md:pb-8">
        <Eyebrow n={1}>{t.eyebrow}</Eyebrow>
        <H1 className="mt-3 max-w-3xl">{t.title}</H1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-700">{t.intro}</p>
        <nav aria-label={t.onThisPage} className="mt-6 flex flex-wrap gap-2">
          {t.sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded-full bg-white px-3 py-1 text-sm text-slate-700 ring-1 ring-slate-300 hover:ring-slate-500">
              {s.title}
            </a>
          ))}
        </nav>
      </Section>

      <Section className="pt-6 md:pt-8">
        <div className="grid gap-x-12 gap-y-12 lg:grid-cols-2">
          {t.sections.map((s, i) => (
            <div key={s.id} id={s.id} className="scroll-mt-24 border-t border-slate-200 pt-6">
              <h2 className="font-display text-[28px] leading-tight font-medium">
                <span className="cite mr-2 text-[0.6em] align-super">[{i + 1}]</span>
                {s.title}
              </h2>
              <ul className="mt-4 space-y-3">
                {s.points.map((p) => (
                  <li key={p} className="flex gap-3 leading-relaxed text-slate-700">
                    <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-md bg-slate-950 text-white">
                      <Check className="size-3" />
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section className="bg-white">
        <h2 className="font-display text-[30px] font-medium">{t.subprocessorsTitle}</h2>
        <div className="mt-5 overflow-x-auto rounded-2xl ring-1 ring-slate-200">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">{t.columns.company}</th>
                <th className="px-4 py-3 font-medium">{t.columns.purpose}</th>
                <th className="px-4 py-3 font-medium">{t.columns.location}</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {SUBPROCESSORS.map((s) => (
                <tr key={s.name} className="border-t border-slate-100">
                  <th scope="row" className="px-4 py-3 font-medium">
                    {s.name}
                  </th>
                  <td className="px-4 py-3 text-slate-700">{s.purpose}</td>
                  <td className="px-4 py-3 text-slate-700">{s.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-slate-600">{t.subprocessorsNote}</p>
      </Section>

      <Section>
        <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <h2 className="font-display text-[30px] font-medium">{t.docsTitle}</h2>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {t.docs.map((d) => (
                <li key={d.href}>
                  <Link href={d.href as "/privacy"} className="block h-full rounded-2xl bg-white p-5 ring-1 ring-slate-200 hover:ring-slate-400">
                    <span className="font-semibold">
                      {d.title} <span aria-hidden>›</span>
                    </span>
                    <span className="mt-1 block text-sm text-slate-600">{d.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl bg-[#fbfaf7] p-6 ring-1 ring-slate-200">
            <h2 className="font-semibold">{t.yourPart.title}</h2>
            <p className="mt-2 leading-relaxed text-slate-700">{t.yourPart.text}</p>
          </div>
        </div>
      </Section>

      <CtaBand title={t.cta.title} sub={t.cta.sub} cta={t.cta.cta} href={t.cta.href} />
    </MarketingShell>
  );
}
