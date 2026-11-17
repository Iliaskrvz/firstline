// The Dodo Payments client for the web app (server only), one per process. Test or live follows the
// key itself (dodo_test_… / dodo_live_…), so a key can't be sent to the wrong host.
import "server-only";
import DodoPayments from "dodopayments";
import { dodoEnvironment, dodoProductIds, fakeDodoCheckouts, type DodoCheckouts } from "@/billing/dodo";
import { PACKS, type PackId } from "@/lib/credits";

let client: DodoPayments | null = null;

/** Fake mode: DODO_API_KEY=fake-dodo, or no key outside production. */
export function dodoFake(): boolean {
  const key = process.env.DODO_API_KEY?.trim();
  return key === "fake-dodo" || (!key && process.env.NODE_ENV !== "production");
}

export function dodoConfigured(): boolean {
  return dodoFake() || !!process.env.DODO_API_KEY?.trim();
}

export function dodoClient(): DodoPayments {
  const key = process.env.DODO_API_KEY!.trim();
  client ??= new DodoPayments({ bearerToken: key, environment: dodoEnvironment(key) });
  return client;
}

export function dodoCheckouts(origin: string): DodoCheckouts {
  if (dodoFake()) return fakeDodoCheckouts(origin);
  const c = dodoClient();
  return { create: (body) => c.checkoutSessions.create(body) };
}

/** Dodo product per pack (DODO_PRODUCT_<PACK>). In fake mode every pack gets a stand-in id. */
export function dodoProducts(): Partial<Record<PackId, string>> {
  const real = dodoProductIds();
  return dodoFake() ? { ...Object.fromEntries(Object.keys(PACKS).map((id) => [id, `pdt_fake_${id}`])), ...real } : real;
}
