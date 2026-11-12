"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createKelviqCheckout, planIdentifiers } from "@/billing/kelviq";
import { requireWorkspaceAdmin } from "@/lib/auth";
import { enabledPacks, isPackId } from "@/lib/credits";
import { publicOrigin } from "@/lib/public-origin";
import { kelviqClient, kelviqConfigured } from "@/server/kelviq";

export async function buyPack(pack: string): Promise<{ error: string } | undefined> {
  if (!isPackId(pack) || !enabledPacks().some((p) => p.id === pack)) return { error: "This pack isn't on sale." };
  if (!kelviqConfigured()) return { error: "Payments aren't set up yet (KELVIQ_API_KEY)." };
  const w = await requireWorkspaceAdmin();
  if (!w.ok) return { error: "Only the workspace owner or an admin can buy credits." };
  const { workspace } = w;
  const origin = publicOrigin(await headers(), process.env.PUBLIC_APP_URL?.trim() || "http://localhost:3000");
  let url: string;
  try {
    url = await createKelviqCheckout(kelviqClient().checkout, { workspaceId: workspace.id, pack, origin, plans: planIdentifiers() });
  } catch (e) {
    return { error: `Kelviq: ${(e as Error).message}` };
  }
  redirect(url);
}
