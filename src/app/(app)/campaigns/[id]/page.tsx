import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge, Card, PageHeader, Skeleton, Stat } from "@/components/ui";
import { leadVars, TokenPreview } from "@/components/template-preview";
import { requireWorkspace } from "@/lib/auth";
import { availableVariables } from "@/lib/csv";
import { estimateCredits } from "@/lib/credits";
import { formatDate, n, STATUS_TONE } from "@/lib/format";
import { parseTemplate } from "@/lib/template";
import type { CampaignRow, LeadRow, TemplateRow } from "@/lib/types";
import { CampaignSettings } from "./campaign-settings";

export const metadata: Metadata = { title: "Campaign" };

const LEAD_COLS = "id, email, first_name, last_name, company, title, linkedin_headline, website, domain, custom, status";
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

  const [{ data: campaign }, { data: leads, count }, { count: withSite }, { data: templates }] = await Promise.all([
    supabase.from("campaigns").select("*").eq("id", id).maybeSingle(),
    supabase.from("leads").select(LEAD_COLS, { count: "exact" }).eq("campaign_id", id).order("created_at").limit(PAGE),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", id).not("domain", "is", null),
    supabase.from("templates").select("id, name, subject, body").order("updated_at", { ascending: false }),
  ]);
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

  return (
    <>
      <PageHeader
        title={c.name}
        description={
          <span className="inline-flex items-center gap-2">
            <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge> Created {formatDate(c.created_at)}
          </span>
        }
      />

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
            <div className="mt-0.5 text-xl font-semibold text-indigo-900">≤ {n(estimateCredits(researchable, c.depth))} credits</div>
            <div className="mt-1 text-xs text-indigo-800/80">The first 5 leads are a free preview.</div>
          </div>
          <div className="text-xs text-slate-500">
            Variables in this list: {vars.map((v) => <code key={v} className="tok-var mr-1 inline-block">{`{{${v}}}`}</code>)}
          </div>
        </Card>
      </div>

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
                <th className="px-6 py-2.5">Status</th>
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
                    <Badge>{l.status}</Badge>
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
