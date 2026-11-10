"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createCheckout } from "@/billing/stripe";
import { requireWorkspace } from "@/lib/auth";
import { isPackId, PACK_IDS } from "@/lib/credits";
import { publicOrigin } from "@/lib/public-origin";
import { serverPool } from "@/server/db";
import { stripeClient, stripeConfigured, stripeTaxOn } from "@/server/stripe";

export async function buyPack(pack: string): Promise<{ error: string } | undefined> {
  if (!isPackId(pack)) return { error: "Unknown pack." };
  if (!stripeConfigured()) return { error: "Payments aren't set up yet (STRIPE_SECRET_KEY)." };
  const { workspace, user } = await requireWorkspace();
  const h = await headers();
  const origin = publicOrigin(h, process.env.PUBLIC_APP_URL?.trim() || "http://localhost:3000");
  let url: string;
  try {
    url = await createCheckout(stripeClient(), serverPool(), { workspace: { id: workspace.id, name: workspace.name, email: user.email }, pack, origin, tax: stripeTaxOn() });
  } catch (e) {
    return { error: `Stripe: ${(e as Error).message}` };
  }
  redirect(url);
}

const AutoTopUpInput = z.object({
  enabled: z.boolean(),
  threshold: z.number().int().min(1, "Use a threshold of at least 1 credit.").max(100_000),
  pack: z.enum(PACK_IDS as [string, ...string[]]),
});

export async function saveAutoTopUp(input: z.input<typeof AutoTopUpInput>): Promise<{ error: string } | { ok: true }> {
  const parsed = AutoTopUpInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid settings." };
  const { workspace } = await requireWorkspace();
  const pool = serverPool();
  const { rows } = await pool.query("select auto_topup->>'payment_method_id' pm from public.workspaces where id = $1", [workspace.id]);
  if (parsed.data.enabled && !rows[0]?.pm) return { error: "Buy a pack once first: that saves the payment method used for top-ups." };
  await pool.query("update public.workspaces set auto_topup = coalesce(auto_topup, '{}'::jsonb) || $2::jsonb where id = $1", [
    workspace.id,
    JSON.stringify({ enabled: parsed.data.enabled, threshold: parsed.data.threshold, pack: parsed.data.pack, last_error: null }),
  ]);
  revalidatePath("/credits");
  return { ok: true };
}
