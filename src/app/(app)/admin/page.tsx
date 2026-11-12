import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, Card, PageHeader, Skeleton, Stat } from "@/components/ui";
import { PRICE_MULTIPLE, TARGET_COST_EUR } from "@/lib/admin";
import { requireAdmin } from "@/lib/auth";
import { n } from "@/lib/format";
import { loadAdmin } from "@/billing/admin-db";
import { anthropicBudget, firecrawlBudget } from "@/billing/budgets";
import { createFirecrawl } from "@/engine/firecrawl";
import { serverPool } from "@/server/db";
import { SenderSwitch } from "./sender-switch";
import { ConcurrencyField } from "./concurrency-field";
import { concurrencyLevel, MAX_WORKSPACE_CONCURRENCY } from "@/lib/concurrency";

export const metadata: Metadata = { title: "Admin" };

const eur = (v: number | null, digits = 2) => (v == null ? "–" : `€${v.toFixed(digits)}`);
const pct = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)}%`);

export default function AdminPage() {
  return (
    <>
      <PageHeader
        title="Admin"
        description={
          <>
            Margin and costs across all workspaces. Costs are real (logged per call); revenue is credits used × average pack price.{" "}
            <Link href="/admin/lab" className="font-medium text-brand-700 hover:underline">
              Quality Lab →
            </Link>
          </>
        }
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Admin />
      </Suspense>
    </>
  );
}

async function Admin() {
  await requireAdmin();
  const pool = serverPool();
  const fcKey = process.env.FIRECRAWL_API_KEY?.trim();
  const [a, fcBudget, anBudget] = await Promise.all([
    loadAdmin(pool),
    firecrawlBudget(pool, fcKey ? await createFirecrawl(fcKey).creditUsage!().catch(() => null) : null),
    anthropicBudget(pool),
  ]);
  const budgets = [fcBudget, anBudget];
  const flagged = a.workspaces.filter((w) => (w.personalShare ?? 0) > 0.5 && w.leads >= 200);
  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Provider budgets this month</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {budgets.map((b) => {
            const tone = b.pct == null ? "bg-slate-300" : b.pct >= 100 ? "bg-rose-600" : b.pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
            const fmt = (v: number) => (b.unit === "usd" ? `${v.toFixed(2)}` : n(v));
            return (
              <div key={b.provider} className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium text-slate-900">{b.label}</span>
                  <span className={b.pct != null && b.pct >= 80 ? "font-medium text-amber-800" : "text-slate-600"}>
                    {fmt(b.used)} {b.limit != null ? `of ${fmt(b.limit)}` : "used"} {b.pct != null && `(${b.pct}%)`}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, b.pct ?? 0)}%` }} />
                </div>
                <p className="text-xs text-slate-500">
                  {b.limit == null
                    ? b.provider === "anthropic"
                      ? "Set ANTHROPIC_MONTHLY_CAP_USD to your Console spend cap to get alerts."
                      : "Firecrawl didn't report the plan size; set FIRECRAWL_MONTHLY_CREDITS."
                    : `From ${b.source}${b.periodEnd ? `, period ends ${b.periodEnd.slice(0, 10)}` : ""}. Email to admins at 80% and 100%.`}
                </p>
              </div>
            );
          })}
        </div>
      </Card>
      {a.drift.level === "warn" && <Card className="bg-amber-50 text-sm text-amber-900">Cost alert: {a.drift.message}</Card>}
      {flagged.length > 0 && (
        <Card className="bg-amber-50 text-sm text-amber-900">
          Check: {flagged.map((w) => w.name).join(", ")} uploaded large lists of mostly personal addresses (gmail, hotmail…) (§11).
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Revenue (30 days)" value={eur(a.totals.revenueEur)} />
        <Stat label="Real cost (30 days)" value={eur(a.totals.costEur)} />
        <Stat label="Margin" value={`${eur(a.totals.marginEur)} · ${pct(a.totals.marginPct)}`} tone="green" />
        <Stat label="Cost per email" value={eur(a.totals.costPerEmailEur, 4)} tone={(a.totals.costPerEmailEur ?? 0) > TARGET_COST_EUR ? "amber" : undefined} />
        <Stat label="Price ÷ cost" value={a.totals.multiple == null ? "–" : `${a.totals.multiple.toFixed(1)}×`} tone={(a.totals.multiple ?? 99) < PRICE_MULTIPLE ? "amber" : undefined} />
      </div>
      <p className="text-xs text-slate-500">
        Target: about €{TARGET_COST_EUR.toFixed(3)} real cost per email and a price of {PRICE_MULTIPLE}× cost (§9). Revenue per used credit now €{a.perCreditEur.toFixed(4)}. USD costs are
        converted at USD_EUR_RATE (default 0.92).
      </p>

      <Card className="overflow-hidden p-0">
        <h2 className="px-6 py-4 text-base font-semibold text-slate-900">Per campaign</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-2.5">Campaign</th>
                <th className="px-4 py-2.5 text-right">Written</th>
                <th className="px-4 py-2.5 text-right">Fallback</th>
                <th className="px-4 py-2.5 text-right">Credits</th>
                <th className="px-4 py-2.5 text-right">Revenue</th>
                <th className="px-4 py-2.5 text-right">Cost</th>
                <th className="px-4 py-2.5 text-right">Per email</th>
                <th className="px-6 py-2.5 text-right">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {a.campaigns.map((c) => (
                <tr key={c.id}>
                  <td className="px-6 py-2.5">
                    <div className="text-slate-900">{c.name}</div>
                    <div className="text-xs text-slate-500">{c.workspace}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right">{n(c.emails)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{n(c.fallbacks)}</td>
                  <td className="px-4 py-2.5 text-right">{n(c.creditsUsed)}</td>
                  <td className="px-4 py-2.5 text-right">{eur(c.m.revenueEur)}</td>
                  <td className="px-4 py-2.5 text-right">{eur(c.m.costEur, 3)}</td>
                  <td className="px-4 py-2.5 text-right">{eur(c.m.costPerEmailEur, 4)}</td>
                  <td className="px-6 py-2.5 text-right">
                    <Badge tone={c.m.marginEur >= 0 ? "green" : "red"}>{pct(c.m.marginPct)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <h2 className="px-6 py-4 text-base font-semibold text-slate-900">Per day (30 days)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-2.5">Day</th>
                <th className="px-4 py-2.5 text-right">Written</th>
                <th className="px-4 py-2.5 text-right">Credits</th>
                <th className="px-4 py-2.5 text-right">Revenue</th>
                <th className="px-4 py-2.5 text-right">Cost</th>
                <th className="px-6 py-2.5 text-right">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {a.days
                .filter((d) => d.creditsUsed || d.costUsd)
                .map((d) => (
                  <tr key={d.day}>
                    <td className="px-6 py-2.5 text-slate-700">{d.day}</td>
                    <td className="px-4 py-2.5 text-right">{n(d.emails)}</td>
                    <td className="px-4 py-2.5 text-right">{n(d.creditsUsed)}</td>
                    <td className="px-4 py-2.5 text-right">{eur(d.m.revenueEur)}</td>
                    <td className="px-4 py-2.5 text-right">{eur(d.m.costEur, 3)}</td>
                    <td className="px-6 py-2.5 text-right">{eur(d.m.marginEur)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <h2 className="px-6 py-4 text-base font-semibold text-slate-900">Workspaces</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {a.workspaces.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5">
              <span>
                <span className="text-slate-900">{w.name}</span> <span className="text-xs text-slate-500">{w.owner}</span>
              </span>
              <span className="flex items-center gap-4 text-xs text-slate-600">
                <span>
                  {n(w.available)} available · {n(w.spent)} used · {n(w.leads)} leads
                  {w.personalShare != null && ` · ${Math.round(w.personalShare * 100)}% personal addresses`}
                </span>
                <ConcurrencyField workspaceId={w.id} value={w.concurrencyLimit} automatic={concurrencyLevel(w.purchased)} max={MAX_WORKSPACE_CONCURRENCY} />
                {w.senderDisabled && <Badge tone="red">sending off</Badge>}
                <SenderSwitch workspaceId={w.id} disabled={w.senderDisabled} />
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
