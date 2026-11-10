"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createKelviqCheckout, planIdentifiers } from "@/billing/kelviq";
import { requireWorkspace } from "@/lib/auth";
import { isPackId } from "@/lib/credits";
import { publicOrigin } from "@/lib/public-origin";
import { kelviqClient, kelviqConfigured } from "@/server/kelviq";

export async function buyPack(pack: string): Promise<{ error: string } | undefined> {
  if (!isPackId(pack)) return { error: "Unknown pack." };
  if (!kelviqConfigured()) return { error: "Payments aren't set up yet (KELVIQ_API_KEY)." };
  const { workspace } = await requireWorkspace();
  const origin = publicOrigin(await headers(), process.env.PUBLIC_APP_URL?.trim() || "http://localhost:3000");
  let url: string;
  try {
    url = await createKelviqCheckout(kelviqClient().checkout, { workspaceId: workspace.id, pack, origin, plans: planIdentifiers() });
  } catch (e) {
    return { error: `Kelviq: ${(e as Error).message}` };
  }
  redirect(url);
}
