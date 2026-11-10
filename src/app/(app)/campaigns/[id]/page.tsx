import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge, Card, PageHeader, Skeleton, Stat } from "@/components/ui";
import { leadVars, TokenPreview } from "@/components/template-preview";
import { requireWorkspace } from "@/lib/auth";
import { availableVariables, FIELD_LABELS } from "@/lib/csv";
import { runCredits } from "@/lib/credits";
import { formatDate, n, STATUS_TONE } from "@/lib/format";
import { parseTemplate } from "@/lib/template";
import type { CampaignRow, LeadRow, TemplateRow } from "@/lib/types";
import { queueConfigured } from "@/server/queue";
import { detectLanguage } from "@/engine/language";
import { defaultOptOutLine } from "@/lib/sender/messages";
import { CampaignSettings } from "./campaign-settings";
import { PreviewButton } from "./preview-button";
import { AutoRefresh } from "./preview/auto-refresh";
import { ResumeButton } from "./resume-button";
import { RunPanel } from "./run-panel";
import { SendPanel } from "./send-panel";
import { SequenceEditor } from "./sequence-editor";

export const metadata: Metadata = { title: "Campaign" };

const LEAD_COLS = "id, email, first_name, last_name, company, title, linkedin_headline, website, domain, custom, status, status_detail";
const IN_FLIGHT = new Set(["queued", "researching", "writing"]);
const SEND_TONE = { queued: "gray", paused: "amber", sent: "indigo", replied: "green", bounced: "red", stopped: "gray" } as const;
type SendRow = { id: string; lead_id: string; step_no: number; status: keyof typeof SEND_TONE; status_detail: string | null };
const PAGE = 50;

export default function CampaignPage(props: PageProps<"/campaigns/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <CampaignDetail params={props.params} />
    </Suspense>
  );
}

async function CampaignDetail({ params }: { params: PageProps<"/campaigns/[id]">["params"] }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await requireWorkspace();

  const [
    { data: campaign },
    { data: leads, count },
    { count: withSite },
    { data: templates },
    { count: previewCountRaw },
    { data: allStatuses },
    { data: sendRows },
    { data: inboxRows },
    { data: stepRows },
    { data: balanceRow },
  ] = await Promise.all([
    supabase.from("campaigns").select("*").eq("id", id).maybeSingle(),
    supabase.from("leads").select(LEAD_COLS, { count: "exact" }).eq("campaign_id", id).order("created_at").limit(PAGE),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", id).not("domain", "is", null),
    supabase.from("templates").select("id, name, subject, body").order("updated_at", { ascending: false }),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", id).not("preview_rank", "is", null),
    supabase.from("leads").select("id, status, domain").eq("campaign_id", id).limit(10_000),
    supabase.from("sends").select("id, lead_id, step_no, status, status_detail").eq("campaign_id", id).limit(50_000),
    supabase.from("inboxes").select("id, email").order("created_at"),
    supabase.from("sequence_steps").select("step_no, delay_days, kind, template_body").eq("campaign_id", id).order("step_no"),
    supabase.from("workspace_balance").select("available").maybeSingle(),
  ]);
  const previewCount = previewCountRaw ?? 0;
  if (!campaign) notFound();
  const c = campaign as CampaignRow;
  const rows = (leads ?? []) as LeadRow[];
  const tpls = (templates ?? []) as Pick<TemplateRow, "id" | "name" | "subject" | "body">[];
  const template = tpls.find((t) => t.id === c.template_id) ?? null;
  const vars = availableVariables(c.column_map);
  const parsed = template ? parseTemplate(template, { availableVariables: vars }) : null;
  const sample = rows.find((l) => l.domain) ?? rows[0];
  const total = count ?? 0;
  const researchable = withSite ?? 0;

  // Run + send state.
  const c2 = campaign as CampaignRow & { send_fallbacks: boolean; send_state: "sending" | "paused" | null; inbox_id: string | null; inbox_ids: string[] | null; opt_out_line: string | null };
  const statuses = (allStatuses ?? []) as { id: string; status: string; domain: string | null }[];
  const byStatus = statuses.reduce<Record<string, number>>((m, l) => ((m[l.status] = (m[l.status] ?? 0) + 1), m), {});
  const inFlight = c.status === "running" && statuses.some((l) => IN_FLIGHT.has(l.status));
  const remaining = (byStatus.queued ?? 0) + (byStatus.failed ?? 0);
  const sends = (sendRows ?? []) as SendRow[];
  // Per lead: the furthest step that went somewhere (else its first email), for the leads table.
  const sendByLead = new Map<string, SendRow>();
  for (const x of [...sends].sort((a, b) => a.step_no - b.step_no)) {
    const cur = sendByLead.get(x.lead_id);
    if (!cur || x.status !== "queued") sendByLead.set(x.lead_id, x);
  }
  const firstSends = sends.filter((x) => x.step_no === 1);
  const sendCounts = firstSends.reduce<Record<string, number>>((m, x) => ((m[x.status] = (m[x.status] ?? 0) + 1), m), {});
  const stepStats: Record<number, { sent: number; replied: number; bounced: number }> = {};
  for (const x of sends) {
    if (x.status === "queued" || x.status === "paused" || x.status === "stopped") continue;
    const st = (stepStats[x.step_no] ??= { sent: 0, replied: 0, bounced: 0 });
    st.sent++;
    if (x.status === "replied") st.replied++;
    if (x.status === "bounced") st.bounced++;
  }
  const readyToQueue = statuses.filter((l) => !sendByLead.has(l.id) && (l.status === "done" || (l.status === "fallback" && c2.send_fallbacks))).length;
  const steps = (stepRows ?? []) as { step_no: number; delay_days: number; kind: "plain" | "personalised"; template_body: string }[];
  const inboxes = (inboxRows ?? []) as { id: string; email: string }[];
  const shownStatus = c.status === "running" && !inFlight ? "done" : c.status;
  const templateOk = !!parsed && parsed.slots.length > 0 && !parsed.issues.some((i) => i.level === "error");

  return (
    <>
      <PageHeader
        title={c.name}
        description={
          <span className="inline-flex items-center gap-2">
            <Badge tone={STATUS_TONE[shownStatus]}>{shownStatus}</Badge> Created {formatDate(c.created_at)}
          </span>
        }
      />

      <AutoRefresh active={inFlight || c2.send_state === "sending"} intervalMs={inFlight ? 3000 : 20_000} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Leads" value={n(total)} />
        <Stat label="With website" value={n(researchable)} tone="green" />
        <Stat label="No website (free fallback)" value={n(total - researchable)} tone={total - researchable ? "amber" : undefined} />
        <Stat label="Removed on import" value={n((c.counts.duplicates ?? 0) + (c.counts.invalid_email ?? 0) + (c.counts.missing_email ?? 0))} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">Email preview</h2>
            {template && (
              <Link href={`/templates/${template.id}`} className="text-sm font-medium text-indigo-700 hover:underline">
                Edit template
              </Link>
            )}
          </div>
          {!template || !parsed ? (
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              Pick a template on the right to see how the email looks for your first lead.
            </div>
          ) : (
            <>
              <p className="mt-1 text-xs text-slate-500">
                For {sample?.email ?? "your first lead"}. <span className="tok-slot">✦ slots</span> are written per lead in
                the next phase.
              </p>
              <div className="mt-4 rounded-xl ring-1 ring-slate-200">
                <div className="border-b border-slate-100 px-4 py-3 text-sm">
                  <span className="text-slate-500">Subject: </span>
                  <span className="font-medium text-slate-900">
                    <TokenPreview tokens={parsed.subject} vars={sample ? leadVars(sample) : {}} />
                  </span>
                </div>
                <div className="whitespace-pre-wrap px-4 py-4 text-sm leading-relaxed text-slate-800">
                  <TokenPreview tokens={parsed.body} vars={sample ? leadVars(sample) : {}} />
                </div>
              </div>
              {parsed.issues.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {parsed.issues.map((i) => (
                    <li key={i.message} className={i.level === "error" ? "text-sm text-rose-700" : "text-sm text-amber-700"}>
                      {i.message}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>

        <Card className="space-y-5 lg:self-start">
          <CampaignSettings campaignId={c.id} templateId={c.template_id} templates={tpls.map((t) => ({ id: t.id, name: t.name }))} />
          <div>
            <div className="text-sm font-medium text-slate-700">Research depth</div>
            <div className="mt-2 space-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked readOnly className="accent-indigo-600" /> Standard: company website
              </label>
              <label className="flex items-center gap-2 text-slate-400">
                <input type="checkbox" disabled /> + Deep web search (+1 credit) <Badge>later</Badge>
              </label>
              <label className="flex items-center gap-2 text-slate-400">
                <input type="checkbox" disabled /> + Local / Google reviews (+2) <Badge>later</Badge>
              </label>
            </div>
          </div>
          <div className="rounded-xl bg-indigo-50 p-4">
            <div className="text-xs font-medium text-indigo-700">Estimated cost</div>
            <div className="mt-0.5 text-xl font-semibold text-indigo-900">≤ {n(runCredits(researchable, c.depth, steps.filter((s) => s.kind === "personalised").length))} credits</div>
            <div className="mt-1 text-xs text-indigo-800/80">The first 5 leads are a free preview.</div>
          </div>
          <PreviewButton
            campaignId={c.id}
            label={previewCount ? "Run the free preview again" : "Run free preview (5 leads)"}
            disabledReason={
              !template
                ? "Pick a template first."
                : !parsed || parsed.slots.length === 0 || parsed.issues.some((i) => i.level === "error")
                  ? "Fix the template first (it needs at least one valid slot)."
                  : !queueConfigured()
                    ? "Add DATABASE_URL to .env.local to run previews (see README)."
                    : null
            }
          />
          {previewCount > 0 && (
            <Link href={`/campaigns/${c.id}/preview`} className="block text-center text-sm font-medium text-indigo-700 hover:underline">
              View preview ({previewCount} leads) →
            </Link>
          )}
          <div className="border-t border-slate-100 pt-5">
            <RunPanel
              campaignId={c.id}
              total={total}
              remaining={remaining}
              sendFallbacks={c2.send_fallbacks}
              running={inFlight}
              disabledReason={!templateOk ? "Pick a template with at least one valid slot first." : !queueConfigured() ? "Add DATABASE_URL to .env.local first." : null}
              creditsNeeded={runCredits(
                statuses.filter((l) => l.domain && (l.status === "queued" || l.status === "failed")).length,
                c.depth,
                steps.filter((s) => s.kind === "personalised").length,
              )}
              available={(balanceRow as { available: number } | null)?.available ?? 0}
            />
            {(c.status === "running" || (byStatus.done ?? 0) + (byStatus.fallback ?? 0) > 0) && (
              <p className="mt-3 text-center text-xs text-slate-600">
                {byStatus.done ?? 0} written · {byStatus.fallback ?? 0} fallback · {byStatus.failed ?? 0} failed
                {inFlight && ` · ${statuses.filter((l) => IN_FLIGHT.has(l.status)).length} in progress`}
              </p>
            )}
          </div>
          {(byStatus.done ?? 0) + (byStatus.fallback ?? 0) > 0 && (
            <a href={`/campaigns/${c.id}/export`} className="block text-center text-sm font-medium text-indigo-700 hover:underline">
              Export CSV for a sending tool (fl_ columns) ↓
            </a>
          )}
          <div className="border-t border-slate-100 pt-5">
            <SendPanel
              campaignId={c.id}
              inboxes={inboxes}
              sendState={c2.send_state}
              sendingInboxIds={c2.inbox_ids ?? []}
              ready={readyToQueue}
              skippedFallbacks={c2.send_fallbacks ? 0 : (byStatus.fallback ?? 0)}
              defaultOptOut={c2.opt_out_line ?? defaultOptOutLine(template ? detectLanguage(template.body) : "en")}
              counts={sendCounts}
            />
          </div>
          <div className="text-xs text-slate-500">
            Variables in this list: {vars.map((v) => <code key={v} className="tok-var mr-1 inline-block">{`{{${v}}}`}</code>)}
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <SequenceEditor
          campaignId={c.id}
          initial={steps.map(({ delay_days, kind, template_body }) => ({ delay_days, kind, template_body }))}
          locked={sends.length > 0}
          hasRun={c.status === "running" || c.status === "done"}
          stats={stepStats}
        />
      </Card>

      <Card className="mt-6">
        <details>
          <summary className="cursor-pointer text-base font-semibold text-slate-900">
            Column mapping <span className="text-sm font-normal text-slate-500">({Object.keys(c.column_map).length} columns, saved on import)</span>
          </summary>
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(c.column_map).map(([header, target]) => (
              <div key={header} className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                <dt className="truncate text-slate-700">{header}</dt>
                <dd className={target === "ignore" ? "shrink-0 text-slate-400" : "shrink-0 font-medium text-slate-900"}>{FIELD_LABELS[target]}</dd>
              </div>
            ))}
          </dl>
        </details>
      </Card>

      <Card className="mt-6 overflow-hidden p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">Leads</h2>
          <span className="text-xs text-slate-500">{total > PAGE ? `First ${PAGE} of ${n(total)}` : `${n(total)} leads`}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-2.5">Email</th>
                <th className="px-6 py-2.5">Name</th>
                <th className="px-6 py-2.5">Company</th>
                <th className="px-6 py-2.5">Domain</th>
                <th className="px-6 py-2.5">Lead</th>
                <th className="px-6 py-2.5">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((l) => (
                <tr key={l.id}>
                  <td className="px-6 py-2.5 text-slate-900">{l.email}</td>
                  <td className="px-6 py-2.5 text-slate-600">{[l.first_name, l.last_name].filter(Boolean).join(" ")}</td>
                  <td className="px-6 py-2.5 text-slate-600">{l.company}</td>
                  <td className="px-6 py-2.5">{l.domain ? <span className="text-slate-600">{l.domain}</span> : <Badge tone="amber">no website</Badge>}</td>
                  <td className="px-6 py-2.5">
                    <Badge tone={l.status === "done" ? "green" : l.status === "fallback" ? "amber" : l.status === "failed" ? "red" : "gray"}>
                      {l.status === "queued" && c.status !== "running" ? "not started" : l.status}
                    </Badge>
                    {l.status_detail && <div className="mt-0.5 text-xs text-slate-500">{l.status_detail}</div>}
                  </td>
                  <td className="px-6 py-2.5">
                    {(() => {
                      const sd = sendByLead.get(l.id);
                      if (!sd) return <span className="text-xs text-slate-400">–</span>;
                      return (
                        <div className="space-y-0.5">
                          <Badge tone={SEND_TONE[sd.status]}>
                            {sd.step_no > 1 ? `step ${sd.step_no} ` : ""}
                            {sd.status}
                          </Badge>
                          {sd.status_detail && <div className="text-xs text-slate-500">{sd.status_detail}</div>}
                          {sd.status === "paused" && <ResumeButton campaignId={c.id} sendId={sd.id} />}
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
