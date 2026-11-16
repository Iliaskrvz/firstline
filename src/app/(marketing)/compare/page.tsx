import type { Metadata } from "next";
import Link from "next/link";
import { CompareSources, CompetitorCostText, FirstLineCostText } from "@/components/marketing/compare-bits";
import { CtaBand, Cross, Eyebrow, H1, H2, MarketingShell, Section } from "@/components/marketing/site";
import { COMPARE } from "@/content/compare";
import { COMPETITORS } from "@/content/competitors";
import { marketingMetadata } from "@/content/meta";
import { PACK_CONFIG } from "@/config/packs";
import { competitorCost, firstLineCost } from "@/lib/price-compare";

export const metadata: Metadata = marketingMetadata("compare", "/compare");

export default function ComparePage() {
  const t = COMPARE;
  const fl = (n: number) => firstLineCost(n, PACK_CONFIG);
  return (
    <MarketingShell locale="en">
      <Section className="pb-8 md:pb-10">
        <Eyebrow n={1}>{t.eyebrow}</Eyebrow>
        <H1 className="mt-3 max-w-3xl">{t.title}</H1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-700">{t.intro}</p>
      </Section>

      <Section className="pt-0 md:pt-0">
        <h2 className="text-lg font-semibold">{t.tableTitle}</h2>
        {/* Phone: one card per tool */}
        <ul className="mt-4 space-y-3 md:hidden">
          <li className="rounded-2xl bg-white p-4 ring-2 ring-brand-500">
            <p className="font-semibold">{t.firstLine.name}</p>
            <p className="mt-1 text-sm text-slate-700">{t.firstLine.model}</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">{t.columns.m300}</dt>
                <dd>
                  <FirstLineCostText cost={fl(300)} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{t.columns.m10k}</dt>
                <dd>
                  <FirstLineCostText cost={fl(10_000)} />
                </dd>
              </div>
            </dl>
          </li>
          {COMPETITORS.map((c) => (
            <li key={c.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <Link href={`/compare/${c.id}` as "/compare"} className="font-semibold underline decoration-slate-300 underline-offset-2">
                {c.name}
              </Link>
              <p className="mt-1 text-sm text-slate-700">{t.models[c.id]}</p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">{t.columns.m300}</dt>
                  <dd>
                    <CompetitorCostText cost={competitorCost(c, 300)} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">{t.columns.m10k}</dt>
                  <dd>
                    <CompetitorCostText cost={competitorCost(c, 10_000)} />
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        {/* Tablet and up: the table */}
        <div className="mt-4 hidden overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">{t.columns.tool}</th>
                <th className="px-4 py-3 font-medium">{t.columns.what}</th>
                <th className="px-4 py-3 font-medium">{t.columns.model}</th>
                <th className="px-4 py-3 font-medium">{t.columns.m300}</th>
                <th className="px-4 py-3 font-medium">{t.columns.m10k}</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-t border-slate-100 bg-brand-50/50">
                <th scope="row" className="px-4 py-4 font-semibold">
                  {t.firstLine.name}
                </th>
                <td className="px-4 py-4 text-slate-700">{t.firstLine.what}</td>
                <td className="px-4 py-4 text-slate-700">{t.firstLine.model}</td>
                <td className="px-4 py-4">
                  <FirstLineCostText cost={fl(300)} />
                </td>
                <td className="px-4 py-4">
                  <FirstLineCostText cost={fl(10_000)} />
                </td>
              </tr>
              {COMPETITORS.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <th scope="row" className="px-4 py-4 font-semibold">
                    <Link href={`/compare/${c.id}` as "/compare"} className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900">
                      {c.name}
                    </Link>
                  </th>
                  <td className="px-4 py-4 text-slate-700">{c.what}</td>
                  <td className="px-4 py-4 text-slate-700">{t.models[c.id]}</td>
                  <td className="px-4 py-4">
                    <CompetitorCostText cost={competitorCost(c, 300)} />
                  </td>
                  <td className="px-4 py-4">
                    <CompetitorCostText cost={competitorCost(c, 10_000)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">
          {t.tableNote}{" "}
          <Link href="/calculator" className="font-medium text-brand-800 underline decoration-brand-200 underline-offset-2">
            {t.calculatorLink} ›
          </Link>
        </p>
      </Section>

      <Section className="bg-white">
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <Eyebrow n={2}>{t.limitsTitle}</Eyebrow>
            <H2>{t.limitsIntro}</H2>
            <ul className="mt-6 space-y-3">
              {t.limits.map((l) => (
                <li key={l} className="flex gap-3 text-[15px] text-slate-700">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-600">
                    <Cross className="size-3" />
                  </span>
                  {l}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <Eyebrow n={3}>{t.togetherTitle}</Eyebrow>
            <p className="mt-4 text-[17px] leading-relaxed text-slate-700">{t.togetherText}</p>
            <h3 className="mt-10 font-semibold">{t.perToolTitle}</h3>
            <ul className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
              {COMPETITORS.map((c) => (
                <li key={c.id}>
                  <Link href={`/compare/${c.id}` as "/compare"} className="flex items-center justify-between py-3 hover:text-brand-800">
                    {t.readMore(c.name)} <span aria-hidden>›</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section>
        <Eyebrow n="†">{t.sourcesTitle}</Eyebrow>
        <div className="mt-4 max-w-3xl">
          <CompareSources list={COMPETITORS} />
        </div>
      </Section>

      <CtaBand title={t.cta.title} sub={t.cta.sub} cta={t.cta.cta} />
    </MarketingShell>
  );
}
