import { OutlookExport } from "./outlook-export";
import { TrackOnce } from "@/components/track-once";
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
import { WAITING_FOR_BATCH } from "@/engine/economy";
import { detectLanguage } from "@/engine/language";
import { defaultOptOutLine } from "@/lib/sender/messages";
import { CampaignSettings, DeepSetting, WriterSetting } from "./campaign-settings";
import { deepEnabled } from "@/lib/deep-switch";
import { PreviewButton } from "./preview-button";
import { AutoRefresh } from "./preview/auto-refresh";
import { ResumeButton } from "./resume-button";
import { RunPanel } from "./run-panel";
import { SendPanel } from "./send-panel";
import { EndCampaign } from "./end-campaign";
import { SequenceEditor } from "./sequence-editor";
import { PushSection } from "./push-section";
import { EmailCheckCard } from "./email-check-card";
import { serverPool } from "@/server/db";
import { emailCheckSummary } from "@/lib/email-check-pg";
import { REASON_LABEL, type EmailReason } from "@/lib/email-check-labels";
import { noFitWarning, VERDICT_LABEL, verdictCounts, type Verdict } from "@/lib/target-customer";
import { TargetCustomerSetting, WriteAnywayButton } from "./target-customer";
import { CampaignSteps } from "./campaign-steps";
import { SplitTestSetting } from "./split-test-setting";
import { stripSlots } from "@/lib/split-test";
import { isAdmin } from "@/lib/admin";
import { campaignSteps } from "@/lib/campaign-steps";

export const metadata: Metadata = { title: "Campaign" };

const LEAD_COLS = "id, email, first_name, last_name, company, title, linkedin_headline, website, domain, custom, status, status_detail, email_status, email_reason, email_suggestion, qualify_verdict, qualify_reason, qualify_override, preview_rank, split_variant";
const FIT_FILTERS = ["fit", "no_fit", "unsure"] as const;
const IN_FLIGHT = new Set(["queued", "researching", "writing"]);
const SEND_TONE = { queued: "gray", paused: "amber", sent: "indigo", replied: "green", bounced: "red", stopped: "gray" } as const;
type SendRow = { id: string; lead_id: string; step_no: number; status: keyof typeof SEND_TONE; status_detail: string | null };
const PAGE = 50;

export default function CampaignPage(props: PageProps<"/campaigns/[id]">) {
  return (
    <>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <CampaignDetail params={props.params} searchParams={props.searchParams} />
      </Suspense>
      <Suspense fallback={null}>
        <FirstCampaignEvent searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

/** Right after the workspace's first campaign is created (?first=1): one analytics event. */
async function FirstCampaignEvent({ searchParams }: { searchParams: PageProps<"/campaigns/[id]">["searchParams"] }) {
  return (await searchParams).first === "1" ? <TrackOnce event="First campaign" param="first" /> : null;
}

async function CampaignDetail({ params, searchParams }: { params: PageProps<"/campaigns/[id]">["params"]; searchParams: PageProps<"/campaigns/[id]">["searchParams"] }) {
  const { id } = await params;
  const fitParam = (await searchParams).fit;
  const fitFilter = FIT_FILTERS.find((f) => f === fitParam) ?? null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, workspace, user } = await requireWorkspace();
  const admin = isAdmin(user.email);

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
    supabase.from("campaigns").select("*").eq("id", id).eq("workspace_id", workspace.id).maybeSingle(),
    (fitFilter
      ? supabase.from("leads").select(LEAD_COLS, { count: "exact" }).eq("campaign_id", id).eq("qualify_verdict", fitFilter)
      : supabase.from("leads").select(LEAD_COLS, { count: "exact" }).eq("campaign_id", id)
    )
      .order("created_at")
      .limit(PAGE),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", id).not("domain", "is", null),
    supabase.from("templates").select("id, name, subject, body").eq("workspace_id", workspace.id).eq("source", "app").order("updated_at", { ascending: false }),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", id).not("preview_rank", "is", null),
    supabase.from("leads").select("id, status, status_detail, domain, qualify_verdict, qualify_override, split_variant").eq("campaign_id", id).limit(10_000),
    supabase.from("sends").select("id, lead_id, step_no, status, status_detail").eq("campaign_id", id).limit(50_000),
    supabase.from("inboxes").select("id, email, type, health").eq("workspace_id", workspace.id).order("created_at"),
    supabase.from("sequence_steps").select("step_no, delay_days, kind, template_body").eq("campaign_id", id).order("step_no"),
    supabase.from("workspace_balance").select("available, lite_available").eq("workspace_id", workspace.id).maybeSingle(),
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
  const total = fitFilter ? (allStatuses ?? []).length : (count ?? 0);
  const shown = count ?? 0;
  const emailCheck = queueConfigured() ? await emailCheckSummary(serverPool(), workspace.id, id) : null;
  const researchable = withSite ?? 0;

  // Run + send state.
  const c2 = campaign as CampaignRow & { send_fallbacks: boolean; send_state: "sending" | "paused" | null; inbox_id: string | null; inbox_ids: string[] | null; opt_out_line: string | null };
  const statuses = (allStatuses ?? []) as { id: string; status: string; status_detail: string | null; domain: string | null; qualify_verdict: Verdict | null; qualify_override: boolean; split_variant: "holdout" | "firstline" | null }[];
  // Lead qualification (Part B): counts, the free skips and the >50% warning (after 10 qualified).
  const fit = verdictCounts(statuses);
  const fitSkipped = statuses.filter((l) => l.status === "skipped" && !l.qualify_override && (l.qualify_verdict === "no_fit" || l.qualify_verdict === "unsure")).length;
  const fitWarning = noFitWarning(fit);
  const started = c.status === "running" || c.status === "done";
  const waitingForBatch = statuses.filter((l) => l.status === "writing" && l.status_detail === WAITING_FOR_BATCH).length;
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
  const inboxes = (inboxRows ?? []) as { id: string; email: string; type: string; health: string }[];
  const shownStatus = c.status === "running" && !inFlight ? "done" : c.status;
  const templateOk = !!parsed && parsed.slots.length > 0 && !parsed.issues.some((i) => i.level === "error");
  const written = (byStatus.done ?? 0) + (byStatus.fallback ?? 0);
  // Leads with a website that still need writing: the same count the Run step reserves for.
  // Holdout leads in a split test get the plain copy for free, so they don't count.
  const toWriteNow = statuses.filter((l) => l.domain && l.split_variant !== "holdout" && (l.status === "queued" || l.status === "failed")).length;
  // Before a split test runs, its leads aren't split yet: half of them will be the free holdout.
  const splitOn = !!(c as CampaignRow & { split_test?: unknown }).split_test;
  const splitPending = splitOn && !statuses.some((l) => l.split_variant);
  const toWrite = splitPending ? Math.ceil(toWriteNow / 2) : toWriteNow;
  const stepState = campaignSteps({ templateOk, previewCount, written, remaining, inFlight, started: c.status === "running" || c.status === "done" });

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

      {/* Leads that only wait for the batch don't need a refresh every 3 seconds. */}
      <AutoRefresh
        active={inFlight || c2.send_state === "sending" || (emailCheck?.byStatus.pending ?? 0) > 0}
        intervalMs={inFlight && waitingForBatch < statuses.filter((l) => IN_FLIGHT.has(l.status)).length ? 3000 : 20_000}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Leads" value={n(total)} />
        <Stat label="With website" value={n(researchable)} tone="green" />
        <Stat label="No website (free fallback)" value={n(total - researchable)} tone={total - researchable ? "amber" : undefined} />
        <Stat label="Removed on import" value={n((c.counts.duplicates ?? 0) + (c.counts.invalid_email ?? 0) + (c.counts.missing_email ?? 0))} />
      </div>

      {fitWarning && (
        <div role="status" className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          <strong>More than half of the checked leads don&apos;t fit your target customer</strong> ({fit.no_fit} of {fit.fit + fit.no_fit + fit.unsure}). They cost you
          nothing, but your lead list may not match who you want to reach, or the description may be too narrow.{" "}
          <Link href={`/campaigns/${c.id}?fit=no_fit`} className="font-medium underline">
            See why
          </Link>
        </div>
      )}

      {emailCheck && total > 0 && (
        <Card className="mt-6">
          <EmailCheckCard campaignId={c.id} {...emailCheck} canChange={c.status !== "done"} />
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">Email preview</h2>
            {template && (
              <Link href={`/templates/${template.id}`} className="text-sm font-medium text-brand-700 hover:underline">
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

        <CampaignSteps
          state={stepState}
          notes={
            <div className="rounded-xl bg-brand-50 p-4 ring-1 ring-brand-100" data-notes="cost">
              <div className="text-xs font-medium text-brand-700">{toWriteNow === researchable || toWrite === 0 ? "Estimated cost" : "Estimated cost of the leads not written yet"}</div>
              <div className="mt-0.5 text-xl font-semibold text-brand-900">{toWrite === 0 && written > 0 ? "All leads written" : <>≤ {n(runCredits(toWrite, c.depth, steps.filter((s) => s.kind === "personalised").length))} credits</>}</div>
              <div className="mt-1 text-xs text-brand-800/80">The first 5 leads are a free preview.</div>
              {/* C7 (review 2026-11-26): the estimate is the worst case; free skips bring it down. */}
              <div className="mt-1 text-xs text-brand-800/80">
                {c.target_customer && !splitOn
                  ? "Leads with a bad address, or that don't fit your target customer, cost nothing."
                  : "Leads with a bad address cost nothing."}
              </div>
              {splitOn ? (
                <div className="mt-1 text-xs font-medium text-amber-800">Split test: half the leads get your plain copy, free.</div>
              ) : null}
            </div>
          }
          steps={{
            setup: {
              title: "Set up",
              summary: template ? `Template: ${template.name} · ${c.writer === "lite" ? "Lite" : "Pro"} writer${splitOn ? " · split test 50/50" : c.target_customer ? " · fit check on" : ""}` : "Pick a template, the writer and who fits",
              body: (
                <>
                  <CampaignSettings campaignId={c.id} templateId={c.template_id} templates={tpls.map((t) => ({ id: t.id, name: t.name }))} />
                  <WriterSetting campaignId={c.id} writer={c.writer} locked={c.status === "running"} />
                  <TargetCustomerSetting campaignId={c.id} target={c.target_customer ?? null} locked={c.status === "running"} splitOn={splitOn} />
                  <div>
                    <div className="text-sm font-medium text-slate-700">Research depth</div>
                    <div className="mt-2 space-y-2 text-sm">
                      <label className="flex items-center gap-2">
                        <input type="radio" checked readOnly className="accent-brand-600" /> Standard: company website
                      </label>
                      {deepEnabled() && <DeepSetting campaignId={c.id} deep={!!c.depth?.deep} locked={c.status === "running"} />}
                    </div>
                  </div>
                  {admin && (
                    <SplitTestSetting
                      campaignId={c.id}
                      split={(c as CampaignRow & { split_test?: { plain_subject: string; plain_body: string } | null }).split_test ?? null}
                      defaultPlain={{ subject: template ? stripSlots(template.subject) : "", body: template ? stripSlots(template.body) : "" }}
                      locked={c.status === "running" || c.status === "done" || statuses.some((l) => l.split_variant)}
                    />
                  )}
                  <div className="text-xs text-slate-500">
                    Variables in this list: {vars.map((v) => <code key={v} className="tok-var mr-1 inline-block">{`{{${v}}}`}</code>)}
                  </div>
                </>
              ),
            },
            preview: {
              title: "Free preview",
              summary: previewCount ? `${previewCount} leads previewed, free` : "5 leads, free, before anything costs credits",
              body: (
                <>
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
                    <Link href={`/campaigns/${c.id}/preview`} className="block text-center text-sm font-medium text-brand-700 hover:underline">
                      View preview ({previewCount} leads) →
                    </Link>
                  )}
                </>
              ),
            },
            run: {
              title: "Run",
              summary: inFlight
                ? `Running · ${statuses.filter((l) => IN_FLIGHT.has(l.status)).length} in progress`
                : written > 0
                  ? `${byStatus.done ?? 0} written · ${byStatus.fallback ?? 0} fallback${remaining ? ` · ${remaining} to go` : ""}`
                  : `${n(remaining)} leads ready to run`,
              body: (
                <div>
                  <RunPanel
                    campaignId={c.id}
                    total={total}
                    remaining={remaining}
                    sendFallbacks={c2.send_fallbacks}
                    running={inFlight}
                    disabledReason={!templateOk ? "Pick a template with at least one valid slot first." : !queueConfigured() ? "Add DATABASE_URL to .env.local first." : null}
                    creditsNeeded={runCredits(
                      toWrite,
                      c.depth,
                      steps.filter((s) => s.kind === "personalised").length,
                    )}
                    available={((balanceRow as { available: number; lite_available: number } | null)?.available ?? 0) + (c.writer === "lite" ? ((balanceRow as { lite_available: number } | null)?.lite_available ?? 0) : 0)}
                    mode={c.mode}
                    waitingForBatch={waitingForBatch}
                  />
                  {(c.status === "running" || (byStatus.done ?? 0) + (byStatus.fallback ?? 0) > 0) && (
                    <p className="mt-3 text-center text-xs text-slate-600">
                      {byStatus.done ?? 0} written · {byStatus.fallback ?? 0} fallback · {byStatus.failed ?? 0} failed
                      {c.target_customer && ` · ${fitSkipped} not a fit (free) · ${fit.unsure} unsure`}
                      {inFlight && ` · ${statuses.filter((l) => IN_FLIGHT.has(l.status)).length} in progress`}
                    </p>
                  )}
                </div>
              ),
            },
            send: {
              title: "Send or export",
              summary: c2.send_state === "sending" ? "Sending from your inbox" : written > 0 ? `${readyToQueue} ready to send · export or push` : "After the run: Gmail, Outlook, your sending tool or CSV",
              body: (
                <>
                {(byStatus.done ?? 0) + (byStatus.fallback ?? 0) > 0 && (
                  <div className="space-y-2">
                    <a href={`/campaigns/${c.id}/export`} className="block text-center text-sm font-medium text-brand-700 hover:underline">
                      Export CSV for a sending tool (fl_ columns) ↓
                    </a>
                    <OutlookExport
                      campaignId={c.id}
                      followUpSteps={steps.map((s) => s.step_no).filter((n) => n > 1)}
                      defaultOptOut={c2.opt_out_line ?? defaultOptOutLine(template ? detectLanguage(template.body) : "en")}
                    />
                  </div>
                )}
                {(byStatus.done ?? 0) + (byStatus.fallback ?? 0) > 0 && (
                  <div className="border-t border-slate-100 pt-5">
                    <PushSection
                      campaignId={c.id}
                      workspaceId={workspace.id}
                      slotKeys={parsed?.slots.map((s) => s.key) ?? []}
                      followUpSteps={steps.filter((s) => s.kind === "personalised").map((s) => s.step_no)}
                      written={(byStatus.done ?? 0) + (byStatus.fallback ?? 0)}
                    />
                  </div>
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
                <EndCampaign campaignId={c.id} endedAt={(c as CampaignRow & { ended_at: string | null }).ended_at} purged={!!(c as CampaignRow & { purged_at: string | null }).purged_at} />

                </>
              ),
            },
          }}
        />
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
          <span className="text-xs text-slate-500">{shown > PAGE ? `First ${PAGE} of ${n(shown)}` : `${n(shown)} leads`}</span>
        </div>
        {fit.fit + fit.no_fit + fit.unsure > 0 && (
          <nav aria-label="Filter by fit" className="flex flex-wrap gap-2 px-6 pb-3 text-xs">
            <Link href={`/campaigns/${c.id}`} className={fitFilter ? "text-slate-600 hover:underline" : "font-semibold text-slate-900"}>
              All
            </Link>
            {FIT_FILTERS.map((f) => (
              <Link key={f} href={`/campaigns/${c.id}?fit=${f}`} className={fitFilter === f ? "font-semibold text-slate-900" : "text-slate-600 hover:underline"}>
                {VERDICT_LABEL[f]} ({fit[f]})
              </Link>
            ))}
          </nav>
        )}
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
                  <td className="px-6 py-2.5 text-slate-900">
                    {l.email}
                    {l.email_status === "invalid" && <div className="text-xs text-rose-700">Invalid: {l.email_reason ? REASON_LABEL[l.email_reason as EmailReason].toLowerCase() : "failed the check"}</div>}
                    {l.email_status === "risky" && <div className="text-xs text-amber-800">Risky: {l.email_reason ? REASON_LABEL[l.email_reason as EmailReason].toLowerCase() : ""}</div>}
                    {l.email_status === "pending" && <div className="text-xs text-slate-400">Checking…</div>}
                    {l.email_suggestion && <div className="text-xs text-slate-500">Did you mean {l.email_suggestion}?</div>}
                  </td>
                  <td className="px-6 py-2.5 text-slate-600">{[l.first_name, l.last_name].filter(Boolean).join(" ")}</td>
                  <td className="px-6 py-2.5 text-slate-600">{l.company}</td>
                  <td className="px-6 py-2.5">{l.domain ? <span className="text-slate-600">{l.domain}</span> : <Badge tone="amber">no website</Badge>}</td>
                  <td className="px-6 py-2.5">
                    <Badge tone={l.status === "done" ? "green" : l.status === "fallback" ? "amber" : l.status === "failed" ? "red" : "gray"}>
                      {l.status === "queued" && c.status !== "running" ? "not started" : l.status}
                    </Badge>
                    {l.status_detail && <div className="mt-0.5 text-xs text-slate-500">{l.status_detail}</div>}
                    {(l as LeadRow & { split_variant?: string | null }).split_variant && (
                      <div className="mt-0.5 text-xs text-amber-800">Split: {(l as LeadRow & { split_variant?: string | null }).split_variant === "holdout" ? "plain copy" : "FirstLine"}</div>
                    )}
                    {l.qualify_verdict && !l.status_detail?.startsWith("Not a fit") && !l.status_detail?.startsWith("Unsure fit") && (
                      <div className={l.qualify_verdict === "unsure" ? "mt-0.5 text-xs text-amber-800" : "mt-0.5 text-xs text-slate-500"}>
                        {l.qualify_override ? "Written anyway · " : ""}
                        {VERDICT_LABEL[l.qualify_verdict]}
                        {l.qualify_reason ? `: ${l.qualify_reason}` : ""}
                      </div>
                    )}
                    {l.status === "skipped" && !l.qualify_override && (l.qualify_verdict === "no_fit" || l.qualify_verdict === "unsure") && (
                      <WriteAnywayButton campaignId={c.id} leadId={l.id} costsCredits={started || (l as LeadRow & { preview_rank?: number | null }).preview_rank == null} />
                    )}
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
