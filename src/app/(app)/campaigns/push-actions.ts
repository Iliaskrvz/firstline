"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { availableFields, validateVariableMap } from "@/integrations/fields";
import { createTool } from "@/integrations/registry";
import { createPush, integrationSecret, retryFailed } from "@/integrations/push-pg";
import type { ToolCampaign } from "@/integrations/types";
import { requireWorkspace } from "@/lib/auth";
import { encryptionKey } from "@/lib/secret-box";
import { parseTemplate } from "@/lib/template";
import { serverPool } from "@/server/db";
import { encryptionConfigured } from "@/server/integrations";
import { enqueuePush, queueConfigured } from "@/server/queue";

const NOT_READY = "Pushing needs DATABASE_URL and INTEGRATIONS_ENCRYPTION_KEY in .env.local.";

async function ownedSecret(integrationId: string) {
  const { workspace, user } = await requireWorkspace();
  const pool = serverPool();
  const s = await integrationSecret(pool, encryptionKey(), integrationId);
  if (!s || s.row.workspace_id !== workspace.id) return null;
  return { s, workspace, user, pool };
}

export async function listToolCampaigns(integrationId: string): Promise<{ error: string } | { campaigns: ToolCampaign[] }> {
  if (!z.uuid().safeParse(integrationId).success) return { error: "Invalid integration." };
  if (!queueConfigured() || !encryptionConfigured()) return { error: NOT_READY };
  const o = await ownedSecret(integrationId);
  if (!o) return { error: "Connect the tool on the Integrations page first." };
  try {
    return { campaigns: await createTool(o.s.row.provider, o.s.apiKey).listCampaigns() };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const Start = z.object({
  campaignId: z.uuid(),
  integrationId: z.uuid(),
  toolCampaignId: z.string().min(1).max(200),
  toolCampaignName: z.string().max(300).nullable(),
  kind: z.enum(["dry_run", "full"]),
  variableMap: z.array(z.object({ field: z.string().max(80), variable: z.string().max(60) })).max(40),
});

export async function startPush(input: z.input<typeof Start>): Promise<{ error: string } | { ok: true }> {
  const p = Start.safeParse(input);
  if (!p.success) return { error: "Invalid push." };
  if (!queueConfigured() || !encryptionConfigured()) return { error: NOT_READY };
  const o = await ownedSecret(p.data.integrationId);
  if (!o) return { error: "Connect the tool on the Integrations page first." };
  // RLS check: the campaign must be visible to this user.
  const { data: campaign } = await (await requireWorkspace()).supabase.from("campaigns").select("id, templates(subject, body)").eq("id", p.data.campaignId).maybeSingle();
  if (!campaign) return { error: "Campaign not found." };
  const tpl = campaign.templates as unknown as { subject: string; body: string } | null;
  const slotKeys = tpl ? parseTemplate(tpl).slots.map((s) => s.key) : [];
  const { rows: steps } = await o.pool.query<{ step_no: number }>("select step_no from public.sequence_steps where campaign_id = $1 and kind = 'personalised' order by step_no", [p.data.campaignId]);
  const allowed = availableFields(slotKeys, steps.map((s) => s.step_no)).map((f) => f.field);
  const map = p.data.variableMap.map((m) => ({ field: m.field, variable: m.variable.trim() })).filter((m) => m.variable);
  const bad = validateVariableMap(map, allowed);
  if (bad) return { error: bad };

  const r = await createPush(o.pool, {
    workspaceId: o.workspace.id,
    campaignId: p.data.campaignId,
    integrationId: p.data.integrationId,
    toolCampaignId: p.data.toolCampaignId,
    toolCampaignName: p.data.toolCampaignName,
    variableMap: map,
    kind: p.data.kind,
    userId: o.user.id,
  });
  if ("error" in r) return r;
  await enqueuePush(r.push.id).catch(() => {}); // the worker also picks up queued pushes on its own
  revalidatePath(`/campaigns/${p.data.campaignId}`);
  return { ok: true };
}

export async function retryFailedPush(pushId: string, campaignId: string): Promise<{ error: string } | { ok: true; count: number }> {
  if (!z.uuid().safeParse(pushId).success || !z.uuid().safeParse(campaignId).success) return { error: "Invalid push." };
  if (!queueConfigured()) return { error: NOT_READY };
  const { workspace } = await requireWorkspace();
  const count = await retryFailed(serverPool(), workspace.id, pushId);
  if (!count) return { error: "Nothing to retry." };
  await enqueuePush(pushId).catch(() => {});
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true, count };
}
