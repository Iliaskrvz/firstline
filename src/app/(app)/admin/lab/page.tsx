import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui";
import { summarise, type EvalSummary, type LeadResult } from "@/engine/lab";
import { LIVE_SKILL_VERSION, SKILLS } from "@/engine/skills";
import { requireAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { MIN_SENT_FOR_RATE, replyRates, type OutcomeCount } from "@/lib/outcomes";
import { serverPool } from "@/server/db";
import { AutoRefresh } from "../../campaigns/[id]/preview/auto-refresh";
import { NewTestSet, RunForm } from "./lab-forms";
import { BakeoffForm } from "./bakeoff-forms";
import { BAKEOFF } from "@/config/models";
import { engineConfig } from "@/engine/config";
import { listBakeoffs } from "@/engine/bakeoff-pg";
import { bakeoffPlan } from "@/engine/bakeoff";
import { QUALIFY_TEST } from "@/engine/qualify-test";
import { listQualifyTests } from "@/engine/qualify-test-pg";
import { QualifyTestForm } from "./qualify-test-form";

export const metadata: Metadata = { title: "Quality Lab" };

export default function LabPage() {
  return (
    <>
      <PageHeader
        title="Quality Lab"
        description={
          <>
            A new skill version writes for a fixed test set next to the live one; checks, the AI judge and a side-by-side comparison decide. Ship only on a clear
            win.{" "}
            <Link href="/admin" className="font-medium text-brand-700 hover:underline">
              ← Admin
            </Link>
          </>
        }
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Lab />
      </Suspense>
    </>
  );
}

type Run = {
  id: number;
  skill_version: string;
  baseline_version: string | null;
  test_set_id: string;
  status: string;
  wins: number;
  losses: number;
  ties: number;
  cost_usd: string;
  provider: string | null;
  error: string | null;
  details: LeadResult[];
  created_at: string;
};

const VERDICT: Record<EvalSummary["verdict"], "green" | "red" | "gray"> = { ship: "green", no: "red", inconclusive: "gray" };

async function Lab() {
  await requireAdmin();
  const pool = serverPool();
  const [{ rows: sets }, { rows: runs }, { rows: outcomeCounts }, bakeoffs, qualifyTests] = await Promise.all([
    pool.query("select id, name, jsonb_array_length(leads)::int n from public.test_sets order by created_at"),
    pool.query("select * from public.eval_runs order by created_at desc limit 20"),
    pool.query<OutcomeCount>("select skill_version, channel, personalised, status, count(*)::int n from public.outcomes group by 1, 2, 3, 4"),
    listBakeoffs(pool),
    listQualifyTests(pool),
  ]);
  const qualifyBusy = qualifyTests.some((t) => t.status === "queued" || t.status === "running");
  const config = engineConfig();
  const plan = bakeoffPlan([], config);
  const bakeoffBusy = bakeoffs.some((b) => b.status === "queued" || b.status === "running");
  const rates = replyRates(outcomeCounts);
  const versions = Object.keys(SKILLS);
  const busy = (runs as Run[]).some((r) => r.status === "queued" || r.status === "running") || bakeoffBusy || qualifyBusy;
  return (
    <div className="space-y-6">
      <AutoRefresh active={busy} intervalMs={10_000} />
      <Card className="space-y-4">
        <h2 className="text-base font-semibold text-slate-900">Compare two skill versions</h2>
        {sets.length ? (
          <RunForm sets={sets.map((s) => ({ id: s.id, name: `${s.name} (${s.n})` }))} versions={versions} live={LIVE_SKILL_VERSION} />
        ) : (
          <p className="text-sm text-slate-500">Add a test set first.</p>
        )}
        <p className="text-xs text-slate-500">
          Versions live in code (src/engine/skills.ts). Live now: {LIVE_SKILL_VERSION}. To ship a winner, set LIVE_SKILL_VERSION to it and deploy. Research comes from the
          30-day domain cache. The side-by-side comparison uses the test-set judge ({config.models.testset_judge.model}).
        </p>
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Model bake-off</h2>
          <p className="mt-1 text-sm text-slate-600">
            Every writer ({plan.writers.map((w) => w.model.replace("claude-", "")).join(", ")}) writes from the same facts. {plan.judge} scores each email and compares
            each writer with {plan.writers[0].model}, blind and in both orders; {plan.agreementJudge} judges the same pairs to see if it agrees. Extraction:{" "}
            {plan.extractors.join(" vs ")} on the first {BAKEOFF.extractionLeads} leads. Ends with a blind sheet of {BAKEOFF.blindPairs} pairs for you. Nothing changes in
            production.
          </p>
        </div>
        {sets.length ? (
          <BakeoffForm
            sets={sets.map((s) => ({ id: s.id, name: s.name, n: s.n }))}
            maxLeads={BAKEOFF.maxLeads}
            creditsPerLead={1 + config.research.maxPages}
            budgetUsd={BAKEOFF.budgetUsd}
            provider={config.llmProvider}
            writers={plan.writers.map((w) => w.model.replace("claude-", ""))}
            busy={bakeoffBusy}
          />
        ) : (
          <p className="text-sm text-slate-500">Add a test set first.</p>
        )}
        {bakeoffs.length > 0 && (
          <ul className="divide-y divide-slate-100 text-sm">
            {bakeoffs.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <Link href={`/admin/lab/bakeoff/${b.id}`} className="font-medium text-brand-700 hover:underline">
                    Bake-off #{b.id}
                  </Link>{" "}
                  <span className="text-slate-500">
                    · {b.test_set_ids.join(" + ")} · {formatDate(b.created_at)}
                    {b.provider === "fake" ? " · test output" : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={b.status === "done" ? "green" : b.status === "failed" || b.status === "over_budget" ? "red" : "indigo"}>{b.status.replace("_", " ")}</Badge>
                  <span className="tabular-nums text-slate-600">
                    ${Number(b.cost_usd).toFixed(2)} of ${Number(b.budget_usd).toFixed(0)}
                    {b.status === "running" && b.progress.phase ? ` · ${b.progress.phase} ${b.progress.done ?? 0}/${b.progress.total ?? "?"}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Qualification test</h2>
          <p className="mt-1 text-sm text-slate-600">
            Leads you labelled by hand (should they fit: yes or no) are researched and checked with the production fit-check model ({config.models.qualify.model}). Columns:
            domain, company, title, target_customer, should_fit. Put who doesn&apos;t fit after &quot;Not:&quot; in target_customer. Template:{" "}
            <code>fixtures/qualify-testset-template.csv</code>. About 50 leads, at most {QUALIFY_TEST.maxLeads}. Nothing changes in production.
          </p>
        </div>
        <QualifyTestForm budgetUsd={QUALIFY_TEST.budgetUsd} provider={config.llmProvider} busy={qualifyBusy} firecrawlPerLead={1 + config.research.maxPages} />
        {qualifyTests.map((t) => (
          <div key={t.id} className="rounded-xl ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span>
                Test #{t.id} · {t.leads} leads · {formatDate(t.created_at)} · approved by {t.approved_by}
                {t.provider === "fake" ? " · test output, no AI used" : ""}
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={t.status === "done" ? "green" : t.status === "failed" || t.status === "over_budget" ? "red" : "indigo"}>{t.status.replace("_", " ")}</Badge>
                <span className="tabular-nums text-slate-600">
                  ${Number(t.cost_usd).toFixed(2)} of ${Number(t.budget_usd).toFixed(0)}
                  {t.status === "running" ? ` · ${t.progress.done ?? 0}/${t.progress.total ?? "?"}` : ""}
                </span>
              </span>
            </div>
            {t.error && <p className="px-4 pb-3 text-xs text-rose-700">{t.error}</p>}
            {t.report && (
              <>
                <dl className="grid grid-cols-2 gap-3 border-t border-slate-100 px-4 py-3 text-sm sm:grid-cols-5">
                  {[
                    ["Accuracy", t.report.accuracy],
                    ["False no_fit (good leads skipped)", t.report.falseNoFitRate],
                    ["Missed no_fit (written for nothing)", t.report.missedNoFitRate],
                    ["Unsure", t.report.unsureRate],
                  ].map(([label, v]) => (
                    <div key={label as string}>
                      <dt className="text-xs text-slate-500">{label}</dt>
                      <dd className="font-semibold tabular-nums text-slate-900">{v == null ? "–" : `${Math.round((v as number) * 100)}%`}</dd>
                    </div>
                  ))}
                  <div>
                    <dt className="text-xs text-slate-500">Cost per lead (the check alone)</dt>
                    <dd className="font-semibold tabular-nums text-slate-900">
                      {t.report.costPerLeadUsd == null ? "–" : `$${t.report.costPerLeadUsd.toFixed(4)}`}{" "}
                      <span className="text-xs font-normal text-slate-500">({t.report.qualifyCostPerLeadUsd == null ? "–" : `$${t.report.qualifyCostPerLeadUsd.toFixed(5)}`})</span>
                    </dd>
                  </div>
                </dl>
                <details className="border-t border-slate-100 px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium text-brand-700">
                    Per lead ({t.report.judged} judged of {t.report.leads})
                  </summary>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="text-slate-500">
                        <tr>
                          <th className="py-1 pr-3">Domain</th>
                          <th className="py-1 pr-3">Should fit</th>
                          <th className="py-1 pr-3">Verdict</th>
                          <th className="py-1 pr-3">Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {t.report.rows.map((r) => (
                          <tr key={r.domain} className={r.correct === false ? "bg-rose-50" : undefined}>
                            <td className="py-1 pr-3">{r.domain}</td>
                            <td className="py-1 pr-3">{r.shouldFit ? "yes" : "no"}</td>
                            <td className="py-1 pr-3">{r.verdict ?? "–"}</td>
                            <td className="py-1 pr-3 text-slate-600">{r.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </div>
        ))}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Reply rate per version</h2>
        {rates.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-4 font-medium">Version</th>
                  <th className="py-1 pr-4 font-medium">Channel</th>
                  <th className="py-1 pr-4 font-medium">Exported / pushed</th>
                  <th className="py-1 pr-4 font-medium">Sent</th>
                  <th className="py-1 pr-4 font-medium">Replied</th>
                  <th className="py-1 pr-4 font-medium">Bounced</th>
                  <th className="py-1 pr-4 font-medium">Unsubscribed</th>
                  <th className="py-1 font-medium">Reply rate</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {rates.map((r) => (
                  <tr key={`${r.skillVersion}-${r.channel}`} className="border-t border-slate-100">
                    <td className="py-1 pr-4">{r.skillVersion}</td>
                    <td className="py-1 pr-4">{r.channel}</td>
                    <td className="py-1 pr-4">{r.handedOver}</td>
                    <td className="py-1 pr-4">{r.sent}</td>
                    <td className="py-1 pr-4">{r.replied}</td>
                    <td className="py-1 pr-4">{r.bounced}</td>
                    <td className="py-1 pr-4">{r.unsubscribed}</td>
                    <td className="py-1">
                      {r.replyRate == null ? "–" : `${r.replyRate}%`}
                      {r.replyRate != null && !r.enough && <span className="ml-1 text-xs text-slate-400">(too early)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No emails sent, exported or pushed yet.</p>
        )}
        <p className="text-xs text-slate-500">
          From outcome rows (no personal data; kept after leads are deleted). Replies only, opens are unreliable. Compare versions from {MIN_SENT_FOR_RATE} sent emails
          each. Exported and pushed emails count as sent once the tool reports it.
        </p>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Test sets</h2>
        <ul className="text-sm text-slate-700">
          {sets.map((s) => (
            <li key={s.id}>
              {s.name} · {s.n} companies
            </li>
          ))}
        </ul>
        <NewTestSet hasStarter={sets.some((s) => s.id === "nl-starter")} />
      </Card>

      {(runs as Run[]).map((r) => {
        const s = summarise(r.details ?? []);
        return (
          <Card key={r.id} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">
                {r.skill_version} vs {r.baseline_version ?? r.skill_version} · {r.test_set_id}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                {r.provider === "fake" && <Badge tone="amber">Test output, no AI used</Badge>}
                <Badge tone={r.status === "done" ? VERDICT[s.verdict] : r.status === "failed" ? "red" : "indigo"}>{r.status === "done" ? s.verdict : r.status}</Badge>
                {formatDate(r.created_at)} · ${Number(r.cost_usd).toFixed(3)}
              </div>
            </div>
            {r.error && <p className="text-xs text-rose-700">{r.error}</p>}
            <p className="text-sm text-slate-700">
              {s.wins} wins · {s.losses} losses · {s.ties} ties · {s.skipped} skipped · judge {s.judgeAvg ?? "–"} vs {s.baselineJudgeAvg ?? "–"} · failed checks{" "}
              {s.ruleFailRate == null ? "–" : `${Math.round(s.ruleFailRate * 100)}%`} vs {s.baselineRuleFailRate == null ? "–" : `${Math.round(s.baselineRuleFailRate * 100)}%`}
            </p>
            {r.status === "done" && <p className="text-sm font-medium text-slate-900">{s.verdictText}</p>}
            {(r.details ?? []).length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs font-medium text-brand-700">Per company</summary>
                <ul className="mt-2 space-y-3 text-xs">
                  {r.details.map((d, i) => (
                    <li key={i} className="rounded-lg bg-slate-50 p-3">
                      <div className="font-medium text-slate-900">
                        {d.company} ({d.domain}) · <span className="text-slate-600">{d.winner}</span> · {d.reason}
                      </div>
                      {d.winner !== "skipped" && (
                        <div className="mt-1 grid gap-2 sm:grid-cols-2">
                          {(["candidate", "baseline"] as const).map((k) => (
                            <div key={k}>
                              <div className="text-slate-500">
                                {k} {d[k].passed ? "✓" : "✗"} {d[k].judgeAvg != null && `· judge ${d[k].judgeAvg.toFixed(1)}`}
                              </div>
                              <div className="text-slate-800">{Object.values(d[k].slots ?? {}).join(" · ") || d[k].error || "–"}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        );
      })}
    </div>
  );
}
