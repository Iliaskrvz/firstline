// DeepSeek peak hours and the prepaid balance (recorded response shape from api-docs.deepseek.com).
import { describe, expect, it } from "vitest";
import { isDeepSeekPeak, nextDeepSeekOffPeak } from "@/engine/costs";
import { balanceAlertEmail, balanceThreshold, fetchDeepSeekBalance, isLow } from "./deepseek-balance";

describe("DeepSeek peak hours (01:00–04:00 and 06:00–10:00 UTC, Monday to Friday)", () => {
  it("knows peak from off-peak, including weekends and listed holidays", () => {
    expect(isDeepSeekPeak(new Date("2026-11-16T01:00:00Z"))).toBe(true); // Monday, start of the first window
    expect(isDeepSeekPeak(new Date("2026-11-16T03:59:00Z"))).toBe(true);
    expect(isDeepSeekPeak(new Date("2026-11-16T04:00:00Z"))).toBe(false); // gap between windows
    expect(isDeepSeekPeak(new Date("2026-11-16T09:30:00Z"))).toBe(true);
    expect(isDeepSeekPeak(new Date("2026-11-16T10:00:00Z"))).toBe(false);
    expect(isDeepSeekPeak(new Date("2026-11-14T02:00:00Z"))).toBe(false); // Saturday
    const holiday = { weekdaysUtc: [1, 2, 3, 4, 5], windowsUtc: [{ from: "01:00", to: "04:00" }], holidays: ["2027-02-08"] };
    expect(isDeepSeekPeak(new Date("2027-02-08T02:00:00Z"), holiday)).toBe(false);
    expect(nextDeepSeekOffPeak(new Date("2026-11-16T02:15:00Z")).toISOString()).toBe("2026-11-16T04:00:00.000Z");
  });
});

describe("DeepSeek balance", () => {
  const RECORDED = { is_available: true, balance_infos: [{ currency: "USD", total_balance: "12.40", granted_balance: "0.00", topped_up_balance: "12.40" }] };
  const reply = (status: number, body: unknown) => async () => ({ ok: status === 200, status, json: async () => body });

  it("reads the balance; null when DeepSeek doesn't answer", async () => {
    const b = await fetchDeepSeekBalance("test-key-not-real", reply(200, RECORDED));
    expect(b).toEqual({ available: true, currency: "USD", total: 12.4, granted: 0, toppedUp: 12.4 });
    expect(await fetchDeepSeekBalance("test-key-not-real", reply(401, {}))).toBeNull();
    expect(await fetchDeepSeekBalance("test-key-not-real", reply(200, { is_available: true, balance_infos: [] }))).toBeNull();
  });

  it("is low below the alert level, or when DeepSeek says it can't serve calls", () => {
    const b = { available: true, currency: "USD", total: 12.4, granted: 0, toppedUp: 12.4 };
    expect(balanceThreshold({ DEEPSEEK_BALANCE_ALERT: "20" })).toBe(20);
    expect(isLow(b, 20)).toBe(true);
    expect(isLow(b, 10)).toBe(false);
    expect(isLow(b, null)).toBe(false);
    expect(isLow({ ...b, available: false }, null)).toBe(true);
    expect(balanceAlertEmail(b, 20, "https://app.example").subject).toBe("FirstLine: DeepSeek balance low (12.40 USD)");
  });
});
