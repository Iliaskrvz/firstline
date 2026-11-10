import type { Metadata } from "next";
import { Suspense } from "react";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import type { InboxHealth } from "@/lib/sender/schedule";
import { queueConfigured } from "@/server/queue";
import { loadInboxes, publicAppUrl, senderScript } from "@/server/sender-view";
import { AutoRefresh } from "../campaigns/[id]/preview/auto-refresh";
import { AddInbox } from "./add-inbox";
import { InboxActions } from "./inbox-actions";

export const metadata: Metadata = { title: "Inboxes" };

const HEALTH: Record<InboxHealth, { label: string; tone: "gray" | "indigo" | "green" | "amber" | "red" }> = {
  not_connected: { label: "Not connected yet", tone: "gray" },
  paused: { label: "Paused", tone: "amber" },
  offline: { label: "Offline", tone: "red" },
  warming: { label: "Warming up", tone: "indigo" },
  healthy: { label: "Healthy", tone: "green" },
};

const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function InboxesPage() {
  return (
    <>
      <PageHeader title="Inboxes" description="Send from your own Gmail through a small script in your Google account. FirstLine never sees your password or your emails." />
      <Suspense fallback={<Skeleton className="h-48" />}>
        <InboxList />
      </Suspense>
    </>
  );
}

function ago(s: number | null) {
  if (s == null) return "never";
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172_800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} days ago`;
}

async function InboxList() {
  const { workspace } = await requireWorkspace();
  const appUrl = publicAppUrl();
  const script = senderScript();
  if (!queueConfigured()) {
    return <Card className="text-sm text-slate-600">Sending needs the database connection: add DATABASE_URL to .env.local (see the README).</Card>;
  }
  const inboxes = await loadInboxes(workspace.id);
  return (
    <div className="space-y-6">
      <AutoRefresh active={inboxes.some((i) => i.health === "not_connected")} intervalMs={10_000} />
      {inboxes.map((i) => (
        <Card key={i.id} className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-slate-900">{i.email}</h2>
                <Badge tone={HEALTH[i.health].tone}>{HEALTH[i.health].label}</Badge>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {i.window.days.map((d) => DAY[d]).join(" ")} · {i.window.start}–{i.window.end} ({i.window.tz}) · last seen {ago(i.lastSeenSecondsAgo)}
                {i.scriptVersion && ` · script ${i.scriptVersion}`} · key {i.keyPrefix}…
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold text-slate-900">
                {i.sentToday} <span className="text-base font-normal text-slate-500">/ {i.cap} today</span>
              </div>
              <div className="text-xs text-slate-500">
                {i.cap < i.dailyCap ? `Warm-up day ${i.warmupDay}: limit grows to ${i.dailyCap}` : `Daily limit ${i.dailyCap}`}
              </div>
              <div className={i.sent7d >= 20 && i.bounced7d / i.sent7d > 0.03 ? "text-xs font-medium text-rose-700" : "text-xs text-slate-500"}>
                Last 7 days: {i.sent7d} sent · {i.sent7d ? Math.round((i.bounced7d / i.sent7d) * 1000) / 10 : 0}% bounced
              </div>
            </div>
          </div>
          {i.lastError && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{i.lastError}</p>}
          <InboxActions inboxId={i.id} paused={i.health === "paused"} appUrl={appUrl} script={script} />
        </Card>
      ))}
      <Card>
        <AddInbox appUrl={appUrl} script={script} />
      </Card>
    </div>
  );
}
