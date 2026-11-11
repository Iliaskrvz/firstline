"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { serverPool } from "@/server/db";

/** §11 abuse switch: turn the Sender API off (or on) for one workspace. */
export async function setSenderDisabled(workspaceId: string, disabled: boolean): Promise<{ error: string } | undefined> {
  if (!z.uuid().safeParse(workspaceId).success) return { error: "Invalid workspace." };
  await requireAdmin();
  await serverPool().query("update public.workspaces set sender_disabled = $2 where id = $1", [workspaceId, disabled]);
  revalidatePath("/admin");
}
