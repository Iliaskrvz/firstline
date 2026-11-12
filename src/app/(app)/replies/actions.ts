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
