"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createPackCheckout } from "@/billing/dodo";
import { requireWorkspaceAdmin } from "@/lib/auth";
import { enabledPacks, isPackId } from "@/lib/credits";
import { publicOrigin } from "@/lib/public-origin";
import { dodoCheckouts, dodoConfigured, dodoProducts } from "@/server/dodo";

export async function buyPack(pack: string): Promise<{ error: string } | undefined> {
  if (!isPackId(pack) || !enabledPacks().some((p) => p.id === pack)) return { error: "This pack isn't on sale." };
  if (!dodoConfigured()) return { error: "Payments aren't set up yet (DODO_API_KEY)." };
  const w = await requireWorkspaceAdmin();
  if (!w.ok) return { error: "Only the workspace owner or an admin can buy credits." };
  const origin = publicOrigin(await headers(), process.env.PUBLIC_APP_URL?.trim() || "http://localhost:3000");
  let url: string;
  try {
    url = await createPackCheckout(dodoCheckouts(origin), { workspaceId: w.workspace.id, pack, origin, products: dodoProducts(), email: w.user.email });
  } catch (e) {
    return { error: `Dodo Payments: ${(e as Error).message}` };
  }
  redirect(url);
}
