import type { Metadata } from "next";
import { Suspense } from "react";
import { Badge, Card, PageHeader, Skeleton, Stat } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { euro, PACK_IDS, PACKS } from "@/lib/credits";
import { formatDate, n } from "@/lib/format";
import { stripeConfigured } from "@/server/stripe";
import { AutoRefresh } from "../campaigns/[id]/preview/auto-refresh";
import { AutoTopUpForm } from "./auto-topup-form";
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
  const { supabase, workspace } = await requireWorkspace();
  const [{ data: bal }, { data: rows }, { data: ws }, { data: camps }] = await Promise.all([
    supabase.from("workspace_balance").select("available, reserved, spent").eq("workspace_id", workspace.id).maybeSingle(),
    supabase.from("credit_ledger").select("id, type, amount, note, campaign_id, lead_id, stripe_event_id, created_at").order("created_at", { ascending: false }).limit(300),
    supabase.from("workspaces").select("auto_topup").eq("id", workspace.id).maybeSingle(),
    supabase.from("campaigns").select("id, name"),
  ]);
  const b = (bal ?? { available: 0, reserved: 0, spent: 0 }) as { available: number; reserved: number; spent: number };
  const auto = (ws?.auto_topup ?? {}) as { enabled?: boolean; threshold?: number; pack?: string; payment_method_id?: string; last_error?: string | null };
  const campaigns = new Map((camps ?? []).map((c) => [c.id, c.name as string]));
  const ledger = (rows ?? []) as { id: number; type: string; amount: number; note: string | null; campaign_id: string | null; lead_id: string | null; stripe_event_id: string | null; created_at: string }[];
  const justPaid = typeof paid === "string" && paid.length > 0;
  const arrived = justPaid && ledger.some((r) => r.stripe_event_id === `checkout:${paid}`);

  // Per-lead rows (reserve / use / return) are summed per campaign so the history stays readable.
  type Row = { key: string; label: string; tone: (typeof TYPE)[string]["tone"]; amount: number; text: string; at: string };
  const grouped = new Map<string, Row>();
  const history: Row[] = [];
  for (const r of ledger) {
    const t = TYPE[r.type] ?? { label: r.type, tone: "gray" as const };
    const signed = r.type === "capture" ? -r.amount : r.type === "reserve" ? r.amount : r.amount;
    if (r.lead_id && r.campaign_id) {
      const key = `${r.campaign_id}:${r.type}`;
      const g = grouped.get(key);
      if (g) g.amount += signed;
      else {
        const row = { key, label: t.label, tone: t.tone, amount: signed, text: campaigns.get(r.campaign_id) ?? "Deleted campaign", at: r.created_at };
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Available" value={n(b.available)} tone="green" />
        <Stat label="Reserved for running campaigns" value={n(b.reserved)} />
        <Stat label="Used so far" value={n(b.spent)} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PACK_IDS.map((id) => {
          const p = PACKS[id];
          return (
            <Card key={id} className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-base font-semibold text-slate-900">{p.name}</h2>
                <span className="text-xs text-slate-500">{euro(Math.round((p.priceCents / p.credits) * 10) / 10)} / email</span>
              </div>
              <div>
                <div className="text-2xl font-semibold text-slate-900">{n(p.credits)} credits</div>
                <div className="text-sm text-slate-600">{euro(p.priceCents)} excl. VAT</div>
              </div>
              <BuyButton pack={id} label={`Buy ${p.name}`} disabled={!stripeConfigured()} />
            </Card>
          );
        })}
      </div>
      {!stripeConfigured() && <p className="text-sm text-amber-800">Payments aren&apos;t set up on this server yet (STRIPE_SECRET_KEY).</p>}
      <p className="text-xs text-slate-500">
        Pay with iDEAL | Wero or card. Business customers in the EU can add a VAT number at checkout (reverse charge). Why this price? We charge about three
        times what research and AI really cost us per email, and nothing when we can&apos;t find anything useful.
      </p>

      <Card>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Automatic top-up</h2>
        {auto.last_error && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{auto.last_error}</p>}
        <AutoTopUpForm
          initial={{ enabled: !!auto.enabled, threshold: auto.threshold ?? 100, pack: auto.pack ?? "starter" }}
          hasPaymentMethod={!!auto.payment_method_id}
          packs={PACK_IDS.map((id) => ({ id, label: `${PACKS[id].name} (${n(PACKS[id].credits)} credits, ${euro(PACKS[id].priceCents)})` }))}
        />
      </Card>

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
