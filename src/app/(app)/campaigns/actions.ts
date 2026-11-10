"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/auth";
import { applyMapping, mappingErrors, MAX_ROWS, type ColumnTarget } from "@/lib/csv";
import { MAX_FREE_RUN } from "@/lib/credits";
import { hasErrors, parseTemplate } from "@/lib/template";
import { enqueueLeads, queueConfigured } from "@/server/queue";
import { serverPool } from "@/server/db";
import { resumeSend, setCampaignSendState, startSending, type StartResult } from "@/sender/db";

const PREVIEW_SIZE = 5;

/** Free preview (§1): research + write the first 5 leads (those with a website first). */
export async function runPreview(campaignId: string): Promise<{ error: string } | undefined> {
  if (!z.uuid().safeParse(campaignId).success) return { error: "Invalid campaign." };
  const { supabase, workspace } = await requireWorkspace();

  const { data: campaign } = await supabase.from("campaigns").select("id, template_id, templates(subject, body)").eq("id", campaignId).maybeSingle();
  if (!campaign) return { error: "Campaign not found." };
  const tpl = campaign.templates as unknown as { subject: string; body: string } | null;
  if (!tpl) return { error: "Pick a template first." };
  const parsed = parseTemplate(tpl);
  if (hasErrors(parsed) || parsed.slots.length === 0) return { error: "The template has errors or no slots. Fix it first." };
  if (!queueConfigured()) return { error: "The preview needs the worker database connection (DATABASE_URL in .env.local). See the README." };

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, domain")
    .eq("campaign_id", campaignId)
    .order("created_at")
    .limit(200);
  if (error) return { error: error.message };
  const withSite = (leads ?? []).filter((l) => l.domain);
  const chosen = [...withSite, ...(leads ?? []).filter((l) => !l.domain)].slice(0, PREVIEW_SIZE);
  if (chosen.length === 0) return { error: "This campaign has no leads." };

  await supabase.from("leads").update({ preview_rank: null }).eq("campaign_id", campaignId).not("preview_rank", "is", null);
  for (const [i, l] of chosen.entries()) {
    const { error: e } = await supabase.from("leads").update({ preview_rank: i + 1, status: "queued", status_detail: null, confidence: null }).eq("id", l.id);
    if (e) return { error: e.message };
  }
  await supabase.from("campaigns").update({ status: "preview" }).eq("id", campaignId);

  try {
    await enqueueLeads(
      chosen.map((l) => ({ leadId: l.id, workspaceId: workspace.id, preview: true, force: true })),
      `preview-${Date.now()}`,
    );
  } catch (e) {
    return { error: `Couldn't reach the job queue: ${(e as Error).message}` };
  }
  revalidatePath(`/campaigns/${campaignId}`);
  redirect(`/campaigns/${campaignId}/preview`);
}

const TARGETS = ["email", "first_name", "last_name", "full_name", "company", "title", "linkedin_headline", "website", "custom", "ignore"] as const satisfies readonly ColumnTarget[];

const ImportInput = z.object({
  name: z.string().trim().min(1, "Give the campaign a name.").max(120),
  rows: z.array(z.record(z.string(), z.string())).min(1, "The file has no rows.").max(MAX_ROWS),
  map: z.record(z.string(), z.enum(TARGETS)),
});

export type ImportResult = { error: string } | undefined;

export async function importLeads(input: z.input<typeof ImportInput>): Promise<ImportResult> {
  const parsed = ImportInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid upload." };
  const { name, rows, map } = parsed.data;

  const mapErr = mappingErrors(map);
  if (mapErr.length) return { error: mapErr[0] };

  // Re-run the same pure logic the browser previewed; never trust the client.
  const result = applyMapping(rows, map);
  if (result.leads.length === 0) return { error: "No importable leads: every row is missing a valid email." };

  const { supabase, workspace } = await requireWorkspace();

  const { data: campaign, error: cErr } = await supabase
    .from("campaigns")
    .insert({ workspace_id: workspace.id, name, column_map: map, counts: result.stats })
    .select("id")
    .single();
  if (cErr || !campaign) return { error: cErr?.message ?? "Could not create the campaign." };

  const CHUNK = 1000;
  for (let i = 0; i < result.leads.length; i += CHUNK) {
    const chunk = result.leads.slice(i, i + CHUNK).map((l) => ({
      ...l,
      campaign_id: campaign.id,
      workspace_id: workspace.id,
    }));
    const { error } = await supabase.from("leads").insert(chunk);
    if (error) {
      await supabase.from("campaigns").delete().eq("id", campaign.id);
      return { error: `Import failed: ${error.message}` };
    }
  }

  revalidatePath("/campaigns");
  redirect(`/campaigns/${campaign.id}`);
}

const SettingsInput = z.object({
  id: z.uuid(),
  template_id: z.uuid().nullable(),
});

export async function updateCampaignSettings(input: z.input<typeof SettingsInput>) {
  const parsed = SettingsInput.safeParse(input);
  if (!parsed.success) return { error: "Invalid settings." };
  const { supabase } = await requireWorkspace();
  const { error } = await supabase
    .from("campaigns")
    .update({ template_id: parsed.data.template_id })
    .eq("id", parsed.data.id);
  if (error) return { error: error.message };
  revalidatePath(`/campaigns/${parsed.data.id}`);
  return { ok: true as const };
}

export async function deleteCampaign(id: string) {
  const { supabase } = await requireWorkspace();
  const { error } = await supabase.from("campaigns").delete().eq("id", id).eq("status", "draft");
  if (error) return { error: error.message };
  revalidatePath("/campaigns");
  redirect("/campaigns");
}

/**
 * Run the whole campaign (§10.4). The user chooses up front what happens when
 * research finds nothing usable: send the neutral version, or skip the lead.
 * Leads already written (e.g. in the preview) are not written again; failed ones are retried.
 */
export async function runCampaign(campaignId: string, sendFallbacks: boolean): Promise<{ error: string } | undefined> {
  if (!z.uuid().safeParse(campaignId).success) return { error: "Invalid campaign." };
  const { supabase, workspace } = await requireWorkspace();
  const { data: campaign } = await supabase.from("campaigns").select("id, templates(subject, body)").eq("id", campaignId).maybeSingle();
  if (!campaign) return { error: "Campaign not found." };
  const tpl = campaign.templates as unknown as { subject: string; body: string } | null;
  if (!tpl) return { error: "Pick a template first." };
  const parsed = parseTemplate(tpl);
  if (hasErrors(parsed) || parsed.slots.length === 0) return { error: "The template has errors or no slots. Fix it first." };
  if (!queueConfigured()) return { error: "Running needs the worker database connection (DATABASE_URL in .env.local)." };

  const { data: leads, error } = await supabase.from("leads").select("id, status").eq("campaign_id", campaignId).limit(MAX_FREE_RUN + 1);
  if (error) return { error: error.message };
  if (!leads?.length) return { error: "This campaign has no leads." };
  if (leads.length > MAX_FREE_RUN) return { error: `While testing, a run is limited to ${MAX_FREE_RUN} leads (credits come in a later phase).` };

  await supabase.from("campaigns").update({ status: "running", send_fallbacks: sendFallbacks }).eq("id", campaignId);
  const todo = leads.filter((l) => l.status === "queued" || l.status === "failed");
  if (todo.length) {
    try {
      await enqueueLeads(
        todo.map((l) => ({ leadId: l.id, workspaceId: workspace.id, preview: false, force: l.status === "failed" })),
        `run-${Date.now()}`,
      );
    } catch (e) {
      return { error: `Couldn't reach the job queue: ${(e as Error).message}` };
    }
  }
  revalidatePath(`/campaigns/${campaignId}`);
}

const StartSending = z.object({
  campaignId: z.uuid(),
  inboxIds: z.array(z.uuid()).min(1, "Pick at least one inbox.").max(20),
  optOutLine: z.string().trim().max(200),
});

export async function startCampaignSending(
  input: z.input<typeof StartSending>,
): Promise<{ error: string } | StartResult> {
  const parsed = StartSending.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  if (!queueConfigured()) return { error: "Sending needs the database connection (DATABASE_URL in .env.local)." };
  const { supabase, workspace } = await requireWorkspace();
  const { data: c } = await supabase.from("campaigns").select("id").eq("id", parsed.data.campaignId).maybeSingle();
  if (!c) return { error: "Campaign not found." };
  try {
    const res = await startSending(serverPool(), {
      workspaceId: workspace.id,
      campaignId: parsed.data.campaignId,
      inboxIds: parsed.data.inboxIds,
      optOutLine: parsed.data.optOutLine || null,
    });
    revalidatePath(`/campaigns/${parsed.data.campaignId}`);
    return res;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function setCampaignSending(campaignId: string, state: "sending" | "paused"): Promise<{ error: string } | undefined> {
  if (!z.uuid().safeParse(campaignId).success) return { error: "Invalid campaign." };
  const { workspace } = await requireWorkspace();
  await setCampaignSendState(serverPool(), workspace.id, campaignId, state);
  revalidatePath(`/campaigns/${campaignId}`);
}

/** Resume a lead paused because a colleague at the same company replied. */
export async function resumeLeadSend(campaignId: string, sendId: string): Promise<{ error: string } | undefined> {
  if (!z.uuid().safeParse(sendId).success) return { error: "Invalid email." };
  const { workspace } = await requireWorkspace();
  if (!(await resumeSend(serverPool(), workspace.id, sendId))) return { error: "This email isn't paused." };
  revalidatePath(`/campaigns/${campaignId}`);
}
