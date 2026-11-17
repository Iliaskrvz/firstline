import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, buttonClass, Card, PageHeader, Skeleton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { formatDate, n, STATUS_TONE } from "@/lib/format";
import type { CampaignRow } from "@/lib/types";
import { ONBOARDING } from "@/content/onboarding";

export const metadata: Metadata = { title: "Campaigns" };

export default function CampaignsPage() {
  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Each campaign is one lead list plus one email template."
        actions={
          <Link href="/campaigns/new" className={buttonClass("primary")}>
            New campaign
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-48" />}>
        <CampaignList />
      </Suspense>
    </>
  );
}

async function CampaignList() {
  const { supabase, workspace } = await requireWorkspace();
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, name, status, counts, created_at, templates(name)")
    .eq("workspace_id", workspace.id)
    .eq("source", "app")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as unknown as (Pick<CampaignRow, "id" | "name" | "status" | "counts" | "created_at"> & {
    templates: { name: string } | null;
  })[];

  if (rows.length === 0) {
    const { data: bal } = await supabase.from("workspace_balance").select("available").eq("workspace_id", workspace.id).maybeSingle();
    const t = ONBOARDING;
    return (
      <Card className="p-6 sm:p-8">
        <h2 className="text-lg font-semibold text-slate-900">{t.title}</h2>
        <p className="mt-1 text-sm text-slate-600">{t.credits(n((bal?.available as number | undefined) ?? 0))}</p>
        <ol className="mt-6 grid gap-3 md:grid-cols-2">
          {t.steps.map((step, i) => (
            <li key={step.title} className={`rounded-xl p-4 ring-1 ${i === 0 ? "bg-brand-50/60 ring-brand-200" : "ring-slate-200"}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-medium text-slate-900">
                  <span className={`grid size-6 place-items-center rounded-full text-xs ${i === 0 ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-600"}`}>{i + 1}</span>
                  {step.title}
                </span>
                <span className="shrink-0 text-xs text-slate-500">{step.time}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.text}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Link href="/campaigns/new" className={buttonClass("primary")}>
            {t.cta}
          </Link>
          <a href={t.templateHref} download className="text-sm font-medium text-brand-700 underline decoration-brand-200 underline-offset-2 hover:decoration-brand-700">
            {t.template}
          </a>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-6 py-3">Name</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3 text-right">Leads</th>
              <th className="px-6 py-3">Template</th>
              <th className="px-6 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-6 py-3 font-medium">
                  <Link href={`/campaigns/${c.id}`} className="text-slate-900 hover:text-brand-700">
                    {c.name}
                  </Link>
                </td>
                <td className="px-6 py-3">
                  <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                </td>
                <td className="px-6 py-3 text-right tabular-nums">{n(c.counts?.imported)}</td>
                <td className="px-6 py-3 text-slate-600">{c.templates?.name ?? <span className="text-slate-400">None</span>}</td>
                <td className="px-6 py-3 text-slate-500">{formatDate(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
