import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, buttonClass, Card, PageHeader, Skeleton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { formatDate, n, STATUS_TONE } from "@/lib/format";
import type { CampaignRow } from "@/lib/types";

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
    return (
      <Card className="py-16 text-center">
        <h2 className="text-base font-semibold text-slate-900">No campaigns yet</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
          Start by uploading a CSV of leads. You&apos;ll map the columns and see exactly what will be imported.
        </p>
        <Link href="/campaigns/new" className={buttonClass("primary", "mt-6")}>
          Upload leads
        </Link>
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
                  <Link href={`/campaigns/${c.id}`} className="text-slate-900 hover:text-indigo-700">
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
