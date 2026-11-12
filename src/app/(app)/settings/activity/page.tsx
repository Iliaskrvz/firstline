import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, PageHeader, Skeleton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { serverPool } from "@/server/db";
import { queueConfigured } from "@/server/queue";
import { activity } from "@/teams/db";

export const metadata: Metadata = { title: "Activity" };

const LABEL: Record<string, string> = {
  "campaign.run": "ran campaign",
  "campaign.stopped": "stopped campaign",
  "campaign.ended": "ended campaign",
  "sending.started": "started sending",
  "push.dry_run": "did a dry-run push of",
  "push.started": "pushed",
  "credits.bought": "bought credits",
  "integration.connected": "connected",
  "integration.disconnected": "disconnected",
  "apikey.created": "created API key",
  "apikey.revoked": "revoked an API key",
  "webhook.added": "added webhook",
  "webhook.removed": "removed a webhook",
  "member.invited": "invited",
  "member.invite_cancelled": "cancelled an invite",
  "member.joined": "joined the workspace",
  "member.removed": "removed",
  "member.left": "left the workspace",
  "member.role_changed": "changed the role of",
  "workspace.ownership_transferred": "made the owner:",
  "workspace.concurrency_changed": "changed the concurrency limit",
};

function detail(action: string, d: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof d.leads === "number") parts.push(`${d.leads} leads`);
  if (typeof d.credits_reserved === "number") parts.push(`${d.credits_reserved} credits reserved`);
  if (typeof d.credits_released === "number") parts.push(`${d.credits_released} credits returned`);
  if (typeof d.credits === "number") parts.push(`${d.credits.toLocaleString("en")} credits`);
  if (typeof d.tool === "string") parts.push(`to ${d.tool}${d.tool_campaign ? ` (${d.tool_campaign})` : ""}`);
  if (typeof d.role === "string") parts.push(`as ${d.role}`);
  if (d.mode === "economy") parts.push("Economy");
  if (action === "workspace.concurrency_changed") parts.push(`to ${d.limit ?? "automatic"}`);
  return parts.join(" · ");
}

export default function ActivityPage() {
  return (
    <>
      <PageHeader title="Activity" description="Who ran, pushed, bought or changed what in this workspace (last 200 events)." />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <List />
      </Suspense>
    </>
  );
}

async function List() {
  const { workspace } = await requireWorkspace();
  if (!queueConfigured()) return <Card className="text-sm text-slate-600">The activity log needs the database connection.</Card>;
  const rows = await activity(serverPool(), workspace.id);
  if (!rows.length) return <Card className="text-sm text-slate-600">Nothing yet.</Card>;
  return (
    <Card className="p-0">
      <ul className="divide-y divide-slate-100 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap justify-between gap-2 px-5 py-2.5">
            <span className="text-slate-800">
              <span className="font-medium">{r.actor}</span> {LABEL[r.action] ?? r.action} {r.target && <span className="font-medium">{r.target}</span>}
              {detail(r.action, r.details) && <span className="text-slate-500"> · {detail(r.action, r.details)}</span>}
            </span>
            <time className="text-xs text-slate-500" dateTime={r.created_at.toISOString()}>
              {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" }).format(r.created_at)}
            </time>
          </li>
        ))}
      </ul>
    </Card>
  );
}
