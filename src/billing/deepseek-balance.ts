// DeepSeek is prepaid. GET /user/balance (api-docs.deepseek.com/api/get-user-balance) tells how much is
// left; /admin shows it and the worker emails the admins once a day while it's below
// DEEPSEEK_BALANCE_ALERT (in the balance's currency, USD or CNY).
import type pg from "pg";
import { DEEPSEEK_BASE_URL } from "@/config/models";

export type DeepSeekBalance = { available: boolean; currency: string; total: number; granted: number; toppedUp: number };

type FetchLike = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

type BalanceResponse = {
  is_available?: boolean;
  balance_infos?: { currency: string; total_balance: string; granted_balance: string; topped_up_balance: string }[];
};

/** The balance (USD when the account has one, else the first currency), or null when it can't be read. */
export async function fetchDeepSeekBalance(apiKey: string, fetchImpl: FetchLike = (u, i) => fetch(u, i)): Promise<DeepSeekBalance | null> {
  try {
    const res = await fetchImpl(`${DEEPSEEK_BASE_URL}/user/balance`, { headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as BalanceResponse;
    const infos = body.balance_infos ?? [];
    const info = infos.find((b) => b.currency === "USD") ?? infos[0];
    if (!info) return null;
    return {
      available: body.is_available !== false,
      currency: info.currency,
      total: Number(info.total_balance) || 0,
      granted: Number(info.granted_balance) || 0,
      toppedUp: Number(info.topped_up_balance) || 0,
    };
  } catch {
    return null;
  }
}

export const balanceThreshold = (env: Record<string, string | undefined> = process.env): number | null => Number(env.DEEPSEEK_BALANCE_ALERT?.trim()) || null;

export const isLow = (b: DeepSeekBalance, threshold: number | null) => !b.available || (threshold != null && b.total < threshold);

/** True once per UTC day while the balance is low (records it), so the alert isn't sent every hour. */
export async function newBalanceAlert(pool: pg.Pool, b: DeepSeekBalance, threshold: number | null, now = new Date()): Promise<boolean> {
  if (!isLow(b, threshold)) return false;
  const r = await pool.query("insert into public.provider_budget_alerts (provider, period, level) values ('deepseek-balance', $1, 0) on conflict do nothing", [
    now.toISOString().slice(0, 10),
  ]);
  return (r.rowCount ?? 0) > 0;
}

export function balanceAlertEmail(b: DeepSeekBalance, threshold: number | null, appUrl: string | null): { subject: string; text: string } {
  const amount = `${b.total.toFixed(2)} ${b.currency}`;
  return {
    subject: b.available ? `FirstLine: DeepSeek balance low (${amount})` : "FirstLine: DeepSeek balance used up",
    text:
      (b.available
        ? `The DeepSeek balance is ${amount}, below your alert level of ${threshold?.toFixed(2)} ${b.currency}.`
        : "DeepSeek says the balance isn't enough for API calls. AI steps fail until you top up.") +
      "\n\nTop up at platform.deepseek.com → Top up." +
      (appUrl ? `\n\nDetails: ${appUrl}/admin` : ""),
  };
}
