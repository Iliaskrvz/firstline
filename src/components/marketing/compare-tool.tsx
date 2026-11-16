// FirstLine vs one tool. Used by the fixed routes src/app/(marketing)/compare/<id>/page.tsx, one per competitor.
import type { Metadata } from "next";
import Link from "next/link";
import { CompareSources, CompetitorCostText, FirstLineCostText } from "@/components/marketing/compare-bits";
import { Check, CtaBand, Eyebrow, H1, MarketingShell, Section } from "@/components/marketing/site";
import { COMPARE, COMPARE_TOOLS } from "@/content/compare";
import { COMPETITORS } from "@/content/competitors";
import { PACK_CONFIG } from "@/config/packs";
import { competitorCost, firstLineCost } from "@/lib/price-compare";

const find = (id: string) => COMPETITORS.find((c) => c.id === id);

/** Metadata for /compare/<id>. Each tool has its own fixed route, so any other address is a real 404. */
export function compareToolMetadata(id: string): Metadata {
  const c = find(id);
  if (!c) throw new Error(`Unknown competitor: ${id}`);
  const title = `FirstLine vs ${c.name}`;
  const description = `${c.name} or FirstLine for personalised cold emails: what each does, what 300 and 10,000 emails a month cost on the public pricing pages, and how to use them together.`;
  return { title, description, alternates: { canonical: `/compare/${c.id}` }, openGraph: { title: `${title} · FirstLine`, description, type: "website", siteName: "FirstLine" } };
}

export function CompareTool({ id }: { id: string }) {
  const c = find(id);
  const extra = c && COMPARE_TOOLS[c.id];
  if (!c || !extra) throw new Error(`Unknown competitor: ${id}`);
  const t = COMPARE.tool;
  const rows = [300, 10_000] as const;
  return (
    <MarketingShell locale="en">
      <Section className="pb-8 md:pb-10">
        <Link href="/compare" className="font-mono text-[12px] text-slate-600 hover:text-slate-900">
          ‹ {t.back}
        </Link>
        <div className="mt-6">
          <Eyebrow n={1}>{t.eyebrow(c.name)}</Eyebrow>
          <H1 className="mt-3">{t.title(c.name)}</H1>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-white p-6 ring-2 ring-brand-500">
            <p className="font-semibold">FirstLine</p>
            <p className="mt-2 text-slate-700">{COMPARE.firstLine.what}</p>
            <p className="mt-3 text-sm text-slate-600">{COMPARE.firstLine.model}</p>
          </div>
          <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
            <p className="font-semibold">{c.name}</p>
            <p className="mt-2 text-slate-700">{c.what}</p>
            <p className="mt-3 text-sm text-slate-600">{COMPARE.models[c.id]}</p>
          </div>
        </div>
      </Section>

      <Section className="bg-white">
        <div className="grid gap-10 md:grid-cols-2">
          {(
            [
              [t.chooseUs, extra.chooseUs, true],
              [t.chooseThem(c.name), extra.chooseThem, false],
            ] as const
          ).map(([title, items, ours]) => (
            <div key={title}>
              <h2 className="font-display text-[28px] leading-tight font-medium">{title}</h2>
              <ul className="mt-4 space-y-3">
                {items.map((x) => (
                  <li key={x} className="flex gap-3 text-[15px] text-slate-700">
                    <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md ${ours ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}>
                      <Check className="size-3" />
                    </span>
                    {x}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 rounded-2xl bg-[#fbfaf7] p-6 ring-1 ring-slate-200">
          <h2 className="font-semibold">{t.together}</h2>
          <p className="mt-2 text-slate-700">{extra.together}</p>
        </div>
      </Section>

      <Section>
        <Eyebrow n={2}>{t.costTitle}</Eyebrow>
        <div className="mt-5 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">{COMPARE.emailsAMonth}</th>
                <th className="px-4 py-3 font-medium">FirstLine</th>
                <th className="px-4 py-3 font-medium">{c.name}</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {rows.map((n) => (
                <tr key={n} className="border-t border-slate-100">
                  <th scope="row" className="px-4 py-4 font-medium">
                    {n.toLocaleString("en-US")}
                  </th>
                  <td className="px-4 py-4">
                    <FirstLineCostText cost={firstLineCost(n, PACK_CONFIG)} />
                  </td>
                  <td className="px-4 py-4">
                    <CompetitorCostText cost={competitorCost(c, n)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">{COMPARE.tableNote}</p>
        <h2 className="mt-10 font-semibold">{t.notesTitle}</h2>
        <div className="mt-3 max-w-3xl">
          <CompareSources list={[c]} />
        </div>
      </Section>

      <CtaBand title={COMPARE.cta.title} sub={COMPARE.cta.sub} cta={COMPARE.cta.cta} />
    </MarketingShell>
  );
}
