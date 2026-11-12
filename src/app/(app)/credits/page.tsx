import type { Metadata } from "next";
import { Suspense } from "react";
import { Badge, Card, PageHeader, Skeleton, Stat } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { enabledPacks, euro } from "@/lib/credits";
import { isAdminRole } from "@/lib/team";
import { formatDate, n } from "@/lib/format";
import { kelviqConfigured } from "@/server/kelviq";
import { AutoRefresh } from "../campaigns/[id]/preview/auto-refresh";
import { BuyButton } from "./buy-button";

export const metadata: Metadata = { title: "Credits" };

const TYPE: Record<string, { label: string; tone: "gray" | "indigo" | "green" | "amber" | "red" }> = {
  purchase: { label: "Bought", tone: "green" },
  bonus: { label: "Bonus", tone: "green" },
  reserve: { label: "Reserved", tone: "gray" },
  capture: { label: "Used", tone: "indigo" },
  release: { label: "Returned", tone: "amber" },
  refund: { label: "Refunded", tone: "amber" },
};

/** A purchase in the last 10 minutes (the webhook usually lands within seconds of paying). */
function boughtJustNow(ledger: { type: string; created_at: string }[]): boolean {
  const since = Date.now() - 10 * 60_000;
  return ledger.some((r) => r.type === "purchase" && new Date(r.created_at).getTime() > since);
}

export default function CreditsPage(props: PageProps<"/credits">) {
  return (
    <>
      <PageHeader title="Credits" description="1 credit = 1 personalised email. No subscription, credits never expire. Fallbacks and previews are free." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Credits searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Credits({ searchParams }: { searchParams: PageProps<"/credits">["searchParams"] }) {
  const { paid } = await searchParams;
  const { supabase, workspace, role } = await requireWorkspace();
  const canBuy = isAdminRole(role);
  const packs = enabledPacks();
  const groups = [
    { kind: "standard", title: "Credit packs", note: "For any campaign.", packs: packs.filter((p) => p.kind === "standard") },
    { kind: "lite", title: "Lite packs", note: "Cheaper, for campaigns with the Lite writer only (shorter research, a smaller AI model).", packs: packs.filter((p) => p.kind === "lite") },
  ].filter((g) => g.packs.length);
  const [{ data: bal }, { data: rows }, { data: camps }] = await Promise.all([
    supabase.from("workspace_balance").select("available, reserved, spent, lite_available").eq("workspace_id", workspace.id).maybeSingle(),
    supabase.from("credit_ledger").select("id, type, amount, note, campaign_id, lead_id, stripe_event_id, source, created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(300),
    supabase.from("campaigns").select("id, name").eq("workspace_id", workspace.id),
  ]);
  const b = (bal ?? { available: 0, reserved: 0, spent: 0, lite_available: 0 }) as { available: number; reserved: number; spent: number; lite_available: number };
  const campaigns = new Map((camps ?? []).map((c) => [c.id, c.name as string]));
  const ledger = (rows ?? []) as { id: number; type: string; amount: number; note: string | null; campaign_id: string | null; lead_id: string | null; stripe_event_id: string | null; source: string | null; created_at: string }[];
  const justPaid = typeof paid === "string" && paid.length > 0;
  const arrived = justPaid && boughtJustNow(ledger);

  // Per-lead rows (reserve / use / return) are summed per campaign so the history stays readable.
  type Row = { key: string; label: string; tone: (typeof TYPE)[string]["tone"]; amount: number; text: string; at: string };
  const grouped = new Map<string, Row>();
  const history: Row[] = [];
  for (const r of ledger) {
    const t = TYPE[r.type] ?? { label: r.type, tone: "gray" as const };
    const signed = r.type === "capture" ? -r.amount : r.type === "reserve" ? r.amount : r.amount;
    if (r.lead_id && r.campaign_id) {
      // API calls are one hidden campaign each: sum them per day instead.
      const api = r.source === "api";
      const key = api ? `api:${r.created_at.slice(0, 10)}:${r.type}` : `${r.campaign_id}:${r.type}`;
      const g = grouped.get(key);
      if (g) g.amount += signed;
      else {
        const row = { key, label: t.label, tone: t.tone, amount: signed, text: api ? "API" : (campaigns.get(r.campaign_id) ?? "Deleted campaign"), at: r.created_at };
        grouped.set(key, row);
        history.push(row);
      }
    } else history.push({ key: String(r.id), label: t.label, tone: t.tone, amount: signed, text: r.note ?? "", at: r.created_at });
  }

  return (
    <div className="space-y-6">
      <AutoRefresh active={justPaid && !arrived} intervalMs={3000} />
      {justPaid && (
        <Card className={arrived ? "bg-emerald-50 text-sm text-emerald-900" : "bg-indigo-50 text-sm text-indigo-900"}>
          {arrived ? "Payment received: your credits are added." : "Payment received. Your credits appear here in a few seconds…"}
        </Card>
      )}

      <div className={`grid grid-cols-1 gap-3 ${b.lite_available > 0 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        <Stat label="Available" value={n(b.available)} tone="green" />
        {b.lite_available > 0 && <Stat label="Lite credits (Lite writer only)" value={n(b.lite_available)} tone="green" />}
        <Stat label="Reserved for running campaigns" value={n(b.reserved)} />
        <Stat label="Used so far" value={n(b.spent)} />
      </div>

      {groups.map((g) => (
        <section key={g.kind} className="space-y-3">
          {groups.length > 1 && (
            <div>
              <h2 className="text-base font-semibold text-slate-900">{g.title}</h2>
              <p className="text-sm text-slate-600">{g.note}</p>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            {g.packs.map((p) => (
              <Card key={p.id} className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-base font-semibold text-slate-900">{p.name}</h3>
                  <span className="text-xs text-slate-500">{euro(Math.round((p.priceCents / p.credits) * 10) / 10)} / email</span>
                </div>
                <div>
                  <div className="text-2xl font-semibold text-slate-900">
                    {n(p.credits)} {p.kind === "lite" ? "Lite credits" : "credits"}
                  </div>
                  <div className="text-sm text-slate-600">{euro(p.priceCents)} excl. VAT</div>
                </div>
                <BuyButton pack={p.id} label={`Buy ${p.name}`} disabled={!kelviqConfigured() || !canBuy} />
              </Card>
            ))}
          </div>
        </section>
      ))}
      {!canBuy && <p className="text-sm text-slate-600">Only the workspace owner or an admin can buy credits. Everyone in the workspace uses them.</p>}
      {!kelviqConfigured() && <p className="text-sm text-amber-800">Payments aren&apos;t set up on this server yet (KELVIQ_API_KEY).</p>}
      <p className="text-xs text-slate-500">
        Pay with iDEAL | Wero or card. Payments are handled by our reseller Kelviq, which adds VAT where it applies and sends the invoice. Why this price? We
        charge about three times what research and AI really cost us per email, and nothing when we can&apos;t find anything useful.
      </p>

      <Card className="overflow-hidden p-0">
        <h2 className="px-6 py-4 text-base font-semibold text-slate-900">History</h2>
        {history.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-slate-500">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {history.map((h) => (
              <li key={h.key} className="flex items-center justify-between gap-3 px-6 py-2.5">
                <span className="flex min-w-0 items-center gap-3">
                  <Badge tone={h.tone}>{h.label}</Badge>
                  <span className="truncate text-slate-700">{h.text}</span>
                </span>
                <span className="flex shrink-0 items-center gap-4">
                  <span className={h.amount < 0 ? "font-medium text-slate-900" : "font-medium text-emerald-700"}>
                    {h.amount > 0 ? "+" : ""}
                    {n(h.amount)}
                  </span>
                  <span className="w-24 text-right text-xs text-slate-500">{formatDate(h.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
