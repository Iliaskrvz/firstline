"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/auth";

/** Take an address (or domain) off the do-not-contact list. */
export async function removeSuppression(entry: { email: string | null; domain: string | null }): Promise<{ error: string } | undefined> {
  const parsed = z.object({ email: z.string().max(254).nullable(), domain: z.string().max(253).nullable() }).safeParse(entry);
  if (!parsed.success || (!parsed.data.email && !parsed.data.domain)) return { error: "Invalid entry." };
  const { supabase, workspace } = await requireWorkspace();
  let q = supabase.from("suppression").delete().eq("workspace_id", workspace.id);
  q = parsed.data.email ? q.eq("email", parsed.data.email) : q.is("email", null);
  q = parsed.data.domain ? q.eq("domain", parsed.data.domain) : q.is("domain", null);
  const { error } = await q;
  if (error) return { error: error.message };
  revalidatePath("/replies");
}

/**
 * Mark a reply as positive (interested), not positive, or unmarked. FirstLine never reads replies;
 * you read them in your inbox and mark them here, so split tests can compare positive replies.
 */
export async function markReplyPositive(sendId: string, positive: boolean | null): Promise<{ error: string } | undefined> {
  if (!z.uuid().safeParse(sendId).success || ![true, false, null].includes(positive)) return { error: "Invalid reply." };
  const { workspace } = await requireWorkspace();
  const { serverPool } = await import("@/server/db");
  const { markReply } = await import("@/lib/split-test-pg");
  const ok = await markReply(serverPool(), { workspaceId: workspace.id, sendId, positive });
  if (!ok) return { error: "Reply not found." };
  revalidatePath("/replies");
  revalidatePath("/admin");
}
