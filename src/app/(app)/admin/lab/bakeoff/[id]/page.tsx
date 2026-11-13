import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui";
import { blindTally, getBakeoff } from "@/engine/bakeoff-pg";
import { requireAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { serverPool } from "@/server/db";
import { AutoRefresh } from "../../../../campaigns/[id]/preview/auto-refresh";
import { BlindPick } from "../../bakeoff-forms";

export const metadata: Metadata = { title: "Model bake-off" };

export default function BakeoffPage(props: PageProps<"/admin/lab/bakeoff/[id]">) {
  return (
    <>
      <PageHeader
        title="Model bake-off"
        description={
          <Link href="/admin/lab" className="font-medium text-brand-700 hover:underline">
            ← Quality Lab
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Report params={props.params} />
      </Suspense>
    </>
  );
}

const pct = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)}%`);
const usd = (v: number | null, d = 4) => (v == null ? "–" : `$${v.toFixed(d)}`);
const secs = (ms: number | null) => (ms == null ? "–" : ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`);

async function Report({ params }: { params: PageProps<"/admin/lab/bakeoff/[id]">["params"] }) {
  await requireAdmin();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const run = await getBakeoff(serverPool(), id);
  if (!run) notFound();
  const active = run.status === "queued" || run.status === "running";
  const r = run.report;
  const tally = r ? blindTally(r, run.picks) : null;
  return (
    <div className="space-y-6">
      <AutoRefresh active={active} intervalMs={10_000} />
      <Card className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span>
          #{run.id} · {run.test_set_ids.join(" + ")} · approved by {run.approved_by} · {formatDate(run.created_at)}
          {run.provider === "fake" ? " · test output, no AI used" : ""}
        </span>
        <span className="flex items-center gap-2">
          <Badge tone={run.status === "done" ? "green" : run.status === "failed" || run.status === "over_budget" ? "red" : "indigo"}>{run.status.replace("_", " ")}</Badge>
          <span className="tabular-nums">
            ${Number(run.cost_usd).toFixed(2)} spent of ${Number(run.budget_usd).toFixed(0)}
            {run.progress.projectedUsd != null ? ` · projected $${Number(run.progress.projectedUsd).toFixed(2)}` : ""}
          </span>
        </span>
        {active && (
          <p className="w-full text-slate-600">
            {run.progress.phase ?? "Waiting for the worker"} {run.progress.total ? `${run.progress.done}/${run.progress.total}` : ""} {run.progress.note ? `· ${run.progress.note}` : ""}
          </p>
        )}
        {run.status === "over_budget" && (
          <p className="w-full text-rose-700">Stopped before going over the budget. The partial results below cover the leads that finished.</p>
        )}
        {run.error && <p className="w-full text-rose-700">{run.error}</p>}
      </Card>

      {r && (
        <>
          <Card className="overflow-hidden p-0">
            <h2 className="px-6 py-4 text-base font-semibold text-slate-900">Writers: cost vs quality</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-6 py-2 font-medium">Writer</th>
                    <th className="px-3 py-2 text-right font-medium">Emails</th>
                    <th className="px-3 py-2 text-right font-medium">vs {r.writers.find((w) => w.writer === r.baseline)?.model.replace("claude-", "")} (W / L / T)</th>
                    <th className="px-3 py-2 text-right font-medium">Judge score</th>
                    <th className="px-3 py-2 text-right font-medium">Rule checks failed</th>
                    <th className="px-3 py-2 text-right font-medium">Claim without fact</th>
                    <th className="px-3 py-2 text-right font-medium">Cost / email</th>
                    <th className="px-6 py-2 text-right font-medium">Time / email</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {r.writers.map((w) => (
                    <tr key={w.writer}>
                      <td className="px-6 py-2 font-medium text-slate-900">{w.model.replace("claude-", "")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{w.emails}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{w.writer === r.baseline ? "baseline" : `${w.wins} / ${w.losses} / ${w.ties}`}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{w.judgeAvg?.toFixed(2) ?? "–"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pct(w.ruleFailRate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pct(w.claimsWithoutFactRate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{usd(w.costPerEmailUsd)}</td>
                      <td className="px-6 py-2 text-right tabular-nums">{secs(w.avgMsPerEmail)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-6 py-3 text-xs text-slate-500">
              W/L/T: the test-set judge&apos;s verdict in both orders (a split verdict counts as a tie). Rule checks: first attempt. Cost: writer calls only, from
              usage_costs. Batch time is the whole batch wait shared over its emails.
            </p>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="space-y-3 text-sm">
              <h2 className="text-base font-semibold text-slate-900">Extraction</h2>
              <table className="w-full">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="py-1 font-medium">Model</th>
                    <th className="py-1 text-right font-medium">Facts / lead</th>
                    <th className="py-1 text-right font-medium">Not on the page</th>
                    <th className="py-1 text-right font-medium">Cost / lead</th>
                  </tr>
                </thead>
                <tbody>
                  {r.extraction.map((e) => (
                    <tr key={e.extractor}>
                      <td className="py-1">{e.model.replace("claude-", "")}</td>
                      <td className="py-1 text-right tabular-nums">{e.leads ? (e.facts / e.leads).toFixed(1) : "–"}</td>
                      <td className="py-1 text-right tabular-nums">
                        {e.facts ? pct((e.unsupported + e.wrong) / e.facts) : "–"} <span className="text-slate-500">({e.wrong} wrong)</span>
                      </td>
                      <td className="py-1 text-right tabular-nums">{usd(e.leads ? e.costUsd / e.leads : null, 5)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-slate-500">Each fact checked against the page it cites by the test-set judge. {r.firecrawlCredits} Firecrawl credits used.</p>
            </Card>

            <Card className="space-y-2 text-sm">
              <h2 className="text-base font-semibold text-slate-900">Judge: does {r.agreementModel} agree with {r.judgeModel}?</h2>
              <p className="text-3xl font-semibold tabular-nums">{pct(r.judgeAgreement.rate)}</p>
              <p className="text-slate-600">
                Same verdict in {r.judgeAgreement.agree} of {r.judgeAgreement.orders} comparisons. Keep {r.agreementModel} as the everyday judge if this is high (about 85% or more).
              </p>
            </Card>
          </div>

          {r.production.length > 0 && (
            <Card className="overflow-hidden p-0">
              <h2 className="px-6 py-4 text-base font-semibold text-slate-900">In production: cost per email and pack margins</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-6 py-2 font-medium">Writer</th>
                      <th className="px-3 py-2 text-right font-medium">Cost / email</th>
                      {r.production[0].packs.map((p) => (
                        <th key={p.pack} className="px-3 py-2 text-right font-medium">
                          {p.pack} (€{p.pricePerCreditEur.toFixed(3)})
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {r.production.map((p) => (
                      <tr key={p.writer}>
                        <td className="px-6 py-2">{r.writers.find((w) => w.writer === p.writer)?.model.replace("claude-", "")}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{usd(p.costPerEmailUsd)}</td>
                        {p.packs.map((x) => (
                          <td key={x.pack} className="px-3 py-2 text-right tabular-nums">
                            {x.marginPct}%
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-6 py-3 text-xs text-slate-500">Writer + extraction + Firecrawl per lead; the judge in the write loop is not included. DeepSeek prices depend on the hour (off-peak is half price); see the model labels. Margin = (price per credit − cost) ÷ price.</p>
            </Card>
          )}

          {r.blind.length > 0 && tally && (
            <Card className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Blind sheet: pick the better email</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {tally.done} of {tally.total} picked. Model names stay hidden until you&apos;ve picked them all.
                </p>
                {tally.complete && tally.count && (
                  <p className="mt-2 text-sm font-medium text-slate-900">
                    Your picks:{" "}
                    {Object.entries(tally.count)
                      .map(([k, v]) => `${k === "same" ? "equally good" : r.writers.find((w) => w.writer === k)?.model.replace("claude-", "")} ${v}`)
                      .join(" · ")}
                  </p>
                )}
              </div>
              {r.blind.map((p) => (
                <div key={p.n} className="space-y-2">
                  <p className="text-xs font-semibold text-slate-500">
                    {p.n}. {p.company ?? "Lead"}
                    {tally.complete ? ` · A = ${p.key.a}, B = ${p.key.b}` : ""}
                  </p>
                  <BlindPick id={run.id} n={p.n} a={p.a} b={p.b} picked={run.picks[String(p.n)] ?? null} />
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
