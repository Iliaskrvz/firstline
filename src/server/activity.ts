// Write an activity-log line for the signed-in user (server only). Never throws.
import "server-only";
import { logActivity } from "@/teams/db";
import { serverPool } from "@/server/db";
import { queueConfigured } from "@/server/queue";

export async function logAction(
  w: { workspace: { id: string }; user: { id: string; email: string | null } },
  action: string,
  target?: string | null,
  details?: Record<string, unknown>,
): Promise<void> {
  if (!queueConfigured()) return;
  await logActivity(serverPool(), { workspaceId: w.workspace.id, userId: w.user.id, actor: w.user.email ?? "unknown user", action, target, details });
}

/** Same, with the campaign's name as the target (names stay readable after a campaign is deleted). */
export async function logCampaignAction(
  w: { workspace: { id: string }; user: { id: string; email: string | null } },
  action: string,
  campaignId: string,
  details?: Record<string, unknown>,
): Promise<void> {
  if (!queueConfigured()) return;
  const { rows } = await serverPool()
    .query<{ name: string }>("select name from public.campaigns where id = $1 and workspace_id = $2", [campaignId, w.workspace.id])
    .catch(() => ({ rows: [] as { name: string }[] }));
  await logAction(w, action, rows[0]?.name ?? campaignId, { campaign_id: campaignId, ...details });
}
