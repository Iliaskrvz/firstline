import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, Suspense } from "react";
import { Badge, Card, cx, PageHeader, Skeleton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { parseTemplate, type Token } from "@/lib/template";
import type { LeadRow } from "@/lib/types";
import { AutoRefresh } from "./auto-refresh";
import { PreviewButton } from "../preview-button";

export const metadata: Metadata = { title: "Preview" };

type Fact = { id: string; text: string; src: string; tier: string };
type CheckItem = { id: string; label: string; pass: boolean; detail?: string };
type Generation = {
  lead_id: string;
  plan: Record<string, unknown> | null;
  slot_outputs: Record<string, string>;
  subject: string;
  full_email: string;
  facts_used: string[];
  checks: { status?: string; items?: CheckItem[]; reason?: string; attempts?: number; detail?: string; rejected?: { slots?: Record<string, string> } };
  judge_scores: Record<string, number | boolean | string[]>;
  research: { status?: string; cached?: boolean; picked?: { url: string; type: string }[]; pages?: { url: string; type: string; title?: string }[]; facts?: Fact[]; notes?: string[]; ai?: string };
  provider: string;
  attempts: number;
  created_at: string;
};
type PreviewLead = LeadRow & { preview_rank: number; status_detail: string | null; confidence: string | null };

const PENDING = new Set(["queued", "researching", "writing"]);
const STATUS: Record<string, { label: string; tone: "gray" | "indigo" | "green" | "amber" | "red" }> = {
  queued: { label: "Queued", tone: "gray" },
  researching: { label: "Researching website…", tone: "indigo" },
  writing: { label: "Writing…", tone: "indigo" },
  done: { label: "Done", tone: "green" },
  fallback: { label: "Fallback (free)", tone: "amber" },
  failed: { label: "Failed", tone: "red" },
  skipped: { label: "Skipped", tone: "gray" },
};
const TIER_LABEL: Record<string, string> = { A: "Website", B: "Google reviews", C: "Lead list", D: "Public mention" };

export default function PreviewPage(props: PageProps<"/campaigns/[id]/preview">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Preview params={props.params} />
    </Suspense>
  );
}

function usd(n: number) {
  return n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`;
}

function ago(seconds: number | null | undefined) {
  if (seconds == null) return null;
  const s = Math.max(0, seconds);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
}

async function Preview({ params }: { params: PageProps<"/campaigns/[id]/preview">["params"] }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await requireWorkspace();

  const { data: campaign } = await supabase.from("campaigns").select("id, name, templates(subject, body)").eq("id", id).maybeSingle();
  if (!campaign) notFound();
  const tpl = campaign.templates as unknown as { subject: string; body: string } | null;

  const { data: leadRows } = await supabase
    .from("leads")
    .select("id, email, first_name, last_name, company, title, linkedin_headline, website, domain, custom, status, status_detail, confidence, preview_rank")
    .eq("campaign_id", id)
    .not("preview_rank", "is", null)
    .order("preview_rank");
  const leads = (leadRows ?? []) as PreviewLead[];
  const ids = leads.map((l) => l.id);

  const [{ data: genRows }, { data: costRows }, { data: worker }] = await Promise.all([
    ids.length
      ? supabase.from("generations").select("*").in("lead_id", ids).eq("is_preview", true).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("usage_costs").select("lead_id, model, provider_units, cost_usd, created_at").in("lead_id", ids) : Promise.resolve({ data: [] }),
    supabase.rpc("worker_status"),
  ]);
  const latest = new Map<string, Generation>();
  for (const g of (genRows ?? []) as Generation[]) if (!latest.has(g.lead_id)) latest.set(g.lead_id, g);
  const costs = (costRows ?? []) as { lead_id: string; model: string; provider_units: number; cost_usd: number; created_at: string }[];
  const w = (worker as { last_seen_at: string | null; seconds_ago: number | null; workers: number; llm_provider: string | null }[] | null)?.[0];
  const workerOnline = w?.seconds_ago != null && w.seconds_ago < 60;
  const pending = leads.some((l) => PENDING.has(l.status));
  const anyFake = [...latest.values()].some((g) => g.provider === "fake");
  const parsed = tpl ? parseTemplate(tpl) : null;

  return (
    <>
      <PageHeader
        title="Free preview"
        description={
          <>
            <Link href={`/campaigns/${id}`} className="text-indigo-700 hover:underline">
              {campaign.name}
            </Link>{" "}
            · first {leads.length} leads · no credits used
          </>
        }
        actions={<PreviewButton campaignId={id} label="Regenerate preview" variant="secondary" />}
      />
      <AutoRefresh active={pending} />

      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <span className={cx("inline-flex items-center gap-2 rounded-full px-3 py-1", workerOnline ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800")}>
          <span className={cx("size-2 rounded-full", workerOnline ? "bg-emerald-500" : "bg-amber-500")} />
          {workerOnline ? `Worker online · last seen ${ago(w!.seconds_ago)}` : w?.seconds_ago != null ? `Worker offline · last seen ${ago(w.seconds_ago)}` : "Worker not running (start it with npm run worker)"}
        </span>
        {anyFake && <Badge tone="amber">Test output, no AI used</Badge>}
        {pending && <span className="text-slate-500">Updating every 3 seconds…</span>}
      </div>

      {leads.length === 0 ? (
        <Card className="py-12 text-center text-sm text-slate-500">No preview yet. Use “Run free preview” on the campaign page.</Card>
      ) : (
        <div className="space-y-6">
          {leads.map((l) => (
            <LeadCard key={l.id} lead={l} gen={latest.get(l.id) ?? null} costs={costs.filter((c) => c.lead_id === l.id)} body={parsed?.body ?? null} subject={parsed?.subject ?? null} />
          ))}
        </div>
      )}
    </>
  );
}

function SlotEmail({ tokens, lead, slots, factsUsed }: { tokens: Token[]; lead: PreviewLead; slots: Record<string, string>; factsUsed: string[] }) {
  const { custom, ...fields } = lead;
  const vars: Record<string, unknown> = { ...(custom ?? {}), ...fields };
  return (
    <>
      {tokens.map((t, i) => {
        if (t.type === "text") return <Fragment key={i}>{t.value}</Fragment>;
        if (t.type === "var") return <Fragment key={i}>{(vars[t.key] as string) ?? ""}</Fragment>;
        const v = slots[t.key];
        if (!v) return <span key={i} className="text-xs text-slate-400">[{t.key} left out]</span>;
        return (
          <span key={i} className="tok-slot" title={`AI-written slot “${t.key}” · cites ${factsUsed.join(", ") || "no facts"}`}>
            {v}
            {factsUsed.length > 0 && <sup className="ml-1 text-[10px] font-semibold text-indigo-500">{factsUsed.join(" ")}</sup>}
          </span>
        );
      })}
    </>
  );
}

function LeadCard({
  lead,
  gen,
  costs,
  body,
  subject,
}: {
  lead: PreviewLead;
  gen: Generation | null;
  costs: { model: string; provider_units: number; cost_usd: number; created_at: string }[];
  body: Token[] | null;
  subject: Token[] | null;
}) {
  const st = STATUS[lead.status] ?? { label: lead.status, tone: "gray" as const };
  const r = gen?.research ?? {};
  const scrapedUrls = new Set((r.pages ?? []).map((p) => p.url));
  const picked = r.picked ?? r.pages ?? [];
  const facts = r.facts ?? [];
  const checks = gen?.checks?.items ?? [];
  const total = costs.reduce((s, c) => s + Number(c.cost_usd), 0);
  const credits = costs.reduce((s, c) => s + Number(c.provider_units ?? 0), 0);

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">
            {lead.preview_rank}. {[lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email} · {lead.company ?? "?"}
          </div>
          <div className="text-xs text-slate-500">
            {lead.domain ?? "no website"} {lead.title && `· ${lead.title}`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {gen?.provider === "fake" && <Badge tone="amber">Test output, no AI used</Badge>}
          {r.cached && <Badge tone="gray">Cached research</Badge>}
          {lead.confidence && lead.status === "done" && <Badge tone={lead.confidence === "high" ? "green" : "indigo"}>{lead.confidence} confidence</Badge>}
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
      </div>

      {lead.status_detail && (
        <div className={cx("px-6 py-2 text-sm", lead.status === "failed" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800")}>{lead.status_detail}</div>
      )}

      {!gen ? (
        <div className="px-6 py-8 text-sm text-slate-500">{PENDING.has(lead.status) ? "Working on it…" : "No result yet."}</div>
      ) : (
        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pages picked</h3>
              {picked.length === 0 ? (
                <p className="mt-1 text-sm text-slate-500">None</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {picked.map((p) => (
                    <li key={p.url} className="flex items-center gap-2">
                      <span className={scrapedUrls.has(p.url) ? "text-emerald-600" : "text-slate-400"}>{scrapedUrls.has(p.url) ? "✓" : "✗"}</span>
                      <span className="w-16 shrink-0 text-xs text-slate-500">{p.type}</span>
                      <a href={p.url} target="_blank" rel="noreferrer" className="truncate text-slate-700 hover:text-indigo-700">
                        {p.url.replace(/^https?:\/\//, "")}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {(r.notes ?? []).length > 0 && <p className="mt-1 text-xs text-slate-400">{r.notes!.join(" · ")}</p>}
            </section>

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Facts found</h3>
              {facts.length === 0 ? (
                <p className="mt-1 text-sm text-slate-500">{r.ai ? `Not extracted: ${r.ai}` : "None"}</p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm">
                  {facts.map((f) => (
                    <li key={f.id} className={cx("rounded-lg p-2", gen.facts_used.includes(f.id) ? "bg-indigo-50/70 ring-1 ring-indigo-100" : "bg-slate-50")}>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold text-slate-700">{f.id}</span>
                        <Badge tone="gray">
                          Tier {f.tier} · {TIER_LABEL[f.tier] ?? f.tier}
                        </Badge>
                        {gen.facts_used.includes(f.id) && <Badge tone="indigo">used</Badge>}
                      </div>
                      <p className="mt-1 text-slate-800">{f.text}</p>
                      {f.src.startsWith("http") ? (
                        <a href={f.src} target="_blank" rel="noreferrer" className="text-xs text-slate-500 hover:text-indigo-700">
                          {f.src.replace(/^https?:\/\//, "")}
                        </a>
                      ) : (
                        <span className="text-xs text-slate-500">{TIER_LABEL[f.tier]}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {gen.plan && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Plan</h3>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(gen.plan, null, 2)}</pre>
              </section>
            )}
          </div>

          <div className="space-y-5">
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</h3>
              <div className="mt-2 rounded-xl ring-1 ring-slate-200">
                <div className="border-b border-slate-100 px-4 py-2.5 text-sm">
                  <span className="text-slate-500">Subject: </span>
                  <span className="font-medium text-slate-900">{subject ? <SlotEmail tokens={subject} lead={lead} slots={gen.slot_outputs} factsUsed={gen.facts_used} /> : gen.subject}</span>
                </div>
                <div className="whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed text-slate-800">
                  {body ? <SlotEmail tokens={body} lead={lead} slots={gen.slot_outputs} factsUsed={gen.facts_used} /> : gen.full_email}
                </div>
              </div>
              {gen.checks?.status === "fallback" && <p className="mt-2 text-xs text-amber-700">Neutral fallback line used. This lead costs 0 credits.</p>}
            </section>

            {checks.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Checks {gen.attempts > 1 && <span className="font-normal normal-case text-slate-400">(after {gen.attempts} attempts)</span>}
                </h3>
                <ul className="mt-2 grid gap-1 text-sm">
                  {checks.map((c) => (
                    <li key={c.id} className="flex items-start gap-2">
                      <span className={c.pass ? "text-emerald-600" : "text-rose-600"}>{c.pass ? "✓" : "✗"}</span>
                      <span className={c.pass ? "text-slate-700" : "text-rose-700"}>
                        {c.label}
                        {c.detail && <span className="text-xs text-slate-400"> · {c.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Real cost of this lead</span>
                <span className="font-semibold tabular-nums text-slate-900">{usd(total)}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {costs.length === 0
                  ? r.cached
                    ? "Research came from the 30-day cache: no new calls."
                    : "No paid calls."
                  : `${credits} Firecrawl credit${credits === 1 ? "" : "s"}${costs.some((c) => c.model.startsWith("claude")) ? " + Claude tokens" : ""}${gen.provider === "fake" ? " · writing: test output ($0)" : ""}`}
              </div>
            </section>
          </div>
        </div>
      )}
    </Card>
  );
}
