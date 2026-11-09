import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = { id: string; email: string | null };
export type Workspace = { id: string; name: string };

/** Verified user from the session JWT. Redirects to /login when signed out. */
export async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");
  const user: CurrentUser = { id: claims.sub, email: (claims.email as string | undefined) ?? null };
  return { supabase, user };
}

/** The user's workspace (one per user in the MVP; created on signup). */
export async function requireWorkspace() {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspaces(id, name)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const ws = data?.workspaces as unknown as Workspace | null;
  if (!ws) throw new Error("No workspace found for this account.");
  return { supabase, user, workspace: ws };
}
