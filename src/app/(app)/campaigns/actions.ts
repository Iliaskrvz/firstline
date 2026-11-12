"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/auth";
import { deepEnabled } from "@/lib/deep-switch";
import { applyMapping, availableVariables, mappingErrors, MAX_ROWS, type ColumnMap, type ColumnTarget } from "@/lib/csv";
import { MAX_FOLLOW_UPS, validateStep } from "@/lib/sender/sequence";
import { creditsPerLead, type Depth } from "@/lib/credits";
import { n } from "@/lib/format";
import { reserveForRun, stopRun } from "@/billing/db";
import { endCampaign } from "@/billing/retention";
import { hasErrors, parseTemplate } from "@/lib/template";
import { enqueueLeads, queueConfigured } from "@/server/queue";
import { logCampaignAction } from "@/server/activity";
import { serverPool } from "@/server/db";
import { resumeSend, setCampaignSendState, startSending, type StartResult } from "@/sender/db";

const PREVIEW_SIZE = 5;

/** Free preview (§1): research + write the first 5 leads (those with a website first). */
export async function runPreview(campaignId: string): Promise<{ error: string } | undefined> {
  if (!z.uuid().safeParse(campaignId).success) return { error: "Invalid campaign." };
  const { supabase, workspace } = await requireWorkspace();

  const { data: campaign } = await supabase.from("campaigns").select("id, template_id, templates(subject, body)").eq("id", campaignId).eq("workspace_id", workspace.id).maybeSingle();
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

export async function updateCampaignDeep(campaignId: string, deep: boolean): Promise<{ error: string } | { ok: true }> {
  if (!z.uuid().safeParse(campaignId).success) return { error: "Invalid setting." };
  if (deep && !deepEnabled()) return { error: "Deep research isn't available." };
  const { supabase, workspace } = await requireWorkspace();
  const { data, error } = await supabase
    .from("campaigns")
    .update({ depth: { deep } })
    .eq("id", campaignId)
    .eq("workspace_id", workspace.id)
    .neq("status", "running")
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Can't change this while the campaign is running." };
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

export async function updateCampaignWriter(campaignId: string, writer: "pro" | "lite"): Promise<{ error: string } | { ok: true }> {
  if (!z.uuid().safeParse(campaignId).success || (writer !== "pro" && writer !== "lite")) return { error: "Invalid setting." };
  const { supabase } = await requireWorkspace();
  const { data, error } = await supabase.from("campaigns").update({ writer }).eq("id", campaignId).neq("status", "running").select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Can't change the writer while the campaign is running." };
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

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
 * Run the whole campaign (§10.4). The user chooses up front what happens when research finds
 * nothing usable (send the neutral version, or skip the lead). Credits (§3): each lead with a
 * website reserves 1 + 1 per personalised follow-up; leads without a website fall back for free.
 * Leads already written (e.g. in the free preview) aren't written or charged again.
 */
export async function runCampaign(campaignId: string, sendFallbacks: boolean, mode: "now" | "economy" = "now"): Promise<{ error: string } | undefined> {
  if (!z.uuid().safeParse(campaignId).success) return { error: "Invalid campaign." };
  if (mode !== "now" && mode !== "economy") return { error: "Invalid speed." };
  const w = await requireWorkspace();
  const { supabase, workspace } = w;
  const { data: campaign } = await supabase.from("campaigns").select("id, status, depth, templates(subject, body)").eq("id", campaignId).eq("workspace_id", workspace.id).maybeSingle();
  if (!campaign) return { error: "Campaign not found." };
  const tpl = campaign.templates as unknown as { subject: string; body: string } | null;
  if (!tpl) return { error: "Pick a template first." };
  const parsed = parseTemplate(tpl);
  if (hasErrors(parsed) || parsed.slots.length === 0) return { error: "The template has errors or no slots. Fix it first." };
  if (!queueConfigured()) return { error: "Running needs the worker database connection (DATABASE_URL in .env.local)." };

  const pool = serverPool();
  // A stopped run can be started again: its skipped leads come back.
  await pool.query("update public.leads set status = 'queued', status_detail = null where campaign_id = $1 and status = 'skipped' and status_detail = 'Run stopped'", [campaignId]);
  const { rows: leads } = await pool.query<{ id: string; status: string; domain: string | null }>(
    "select id, status, domain from public.leads where campaign_id = $1 and workspace_id = $2 order by created_at",
    [campaignId, workspace.id],
  );
  if (!leads.length) return { error: "This campaign has no leads." };
  const todo = leads.filter((l) => l.status === "queued" || l.status === "failed");
  if (!todo.length) return { error: "Every lead is already written." };

  const { count: personalised } = await supabase
    .from("sequence_steps")
    .select("step_no", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("kind", "personalised");
  // Deep reserves its extra credit only while Deep is switched on; it's charged only when used.
  const perLead = creditsPerLead({ deep: !!(campaign.depth as Depth | null)?.deep && deepEnabled() }) + (personalised ?? 0);
  const reserved = await reserveForRun(pool, { workspaceId: workspace.id, leadIds: todo.filter((l) => l.domain).map((l) => l.id), perLead });
  if (!reserved.ok) {
    return { error: `This run needs up to ${n(reserved.need)} credits and you have ${n(reserved.available)}. Buy credits first (Credits page).` };
  }

  await supabase.from("campaigns").update({ status: "running", send_fallbacks: sendFallbacks, mode }).eq("id", campaignId);
  try {
    await enqueueLeads(
      todo.map((l) => ({ leadId: l.id, workspaceId: workspace.id, preview: false, force: l.status === "failed" })),
      `run-${Date.now()}`,
    );
  } catch (e) {
    return { error: `Couldn't reach the job queue: ${(e as Error).message}. Your credits stay reserved; run again to retry.` };
  }
  await logCampaignAction(w, "campaign.run", campaignId, { leads: todo.length, credits_reserved: reserved.credits, mode });
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/credits");
}

/** Stop a running campaign: leads not started are skipped and their reserved credits come back. */
export async function stopCampaignRun(campaignId: string): Promise<{ error: string } | { released: number }> {
  if (!z.uuid().safeParse(campaignId).success) return { error: "Invalid campaign." };
  const w = await requireWorkspace();
  const { released } = await stopRun(serverPool(), w.workspace.id, campaignId);
  await logCampaignAction(w, "campaign.stopped", campaignId, { credits_released: released });
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/credits");
  return { released };
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
  const w = await requireWorkspace();
  const { supabase, workspace } = w;
  const { data: c } = await supabase.from("campaigns").select("id").eq("id", parsed.data.campaignId).eq("workspace_id", workspace.id).maybeSingle();
  if (!c) return { error: "Campaign not found." };
  try {
    const res = await startSending(serverPool(), {
      workspaceId: workspace.id,
      campaignId: parsed.data.campaignId,
      inboxIds: parsed.data.inboxIds,
      optOutLine: parsed.data.optOutLine || null,
    });
    await logCampaignAction(w, "sending.started", parsed.data.campaignId, { inboxes: parsed.data.inboxIds.length });
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

const SequenceInput = z.object({
  campaignId: z.uuid(),
  steps: z
    .array(
      z.object({
        delay_days: z.number().int(),
        kind: z.enum(["plain", "personalised"]),
        template_body: z.string().max(5000),
      }),
    )
    .max(MAX_FOLLOW_UPS, `At most ${MAX_FOLLOW_UPS} follow-ups.`),
});

/**
 * Save the follow-up steps (2, 3, …). Locked once sending started. Personalised steps are written
 * during the run, so they can't be added or changed after it; plain steps can.
 */
export async function saveSequence(input: z.input<typeof SequenceInput>): Promise<{ error: string } | { ok: true }> {
  const parsed = SequenceInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid sequence." };
  const { campaignId, steps } = parsed.data;
  const { supabase, workspace } = await requireWorkspace();

  const { data: campaign } = await supabase.from("campaigns").select("id, status, column_map").eq("id", campaignId).eq("workspace_id", workspace.id).maybeSingle();
  if (!campaign) return { error: "Campaign not found." };
  const { count: sent } = await supabase.from("sends").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId);
  if (sent) return { error: "The sequence is locked once sending has started." };

  const vars = availableVariables(campaign.column_map as ColumnMap);
  for (const [i, st] of steps.entries()) {
    const problems = validateStep(st, vars);
    if (problems.length) return { error: `Follow-up ${i + 2}: ${problems[0]}` };
  }

  const { data: existing } = await supabase.from("sequence_steps").select("step_no, kind, template_body").eq("campaign_id", campaignId).order("step_no");
  const personalised = (list: { kind: string; template_body: string }[], offset: number) =>
    JSON.stringify(list.map((s, i) => ({ s: i + offset, ...s })).filter((s) => s.kind === "personalised").map((s) => [s.s, s.template_body]));
  const hasRun = campaign.status === "running" || campaign.status === "done";
  if (hasRun && personalised(steps, 2) !== personalised((existing ?? []).map((e) => ({ kind: e.kind, template_body: e.template_body })), 2)) {
    return { error: "Personalised follow-ups are written during the run, so they can't change after it. Plain follow-ups can still be added." };
  }

  const { error: delErr } = await supabase.from("sequence_steps").delete().eq("campaign_id", campaignId);
  if (delErr) return { error: delErr.message };
  if (steps.length) {
    const { error } = await supabase.from("sequence_steps").insert(
      steps.map((st, i) => ({ campaign_id: campaignId, workspace_id: workspace.id, step_no: i + 2, delay_days: st.delay_days, kind: st.kind, template_body: st.template_body })),
    );
    if (error) return { error: error.message };
  }
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

/** End a campaign (§11): sending stops, open credits come back, lead data is deleted 30 days later. */
export async function endCampaignAction(campaignId: string): Promise<{ error: string } | undefined> {
  if (!z.uuid().safeParse(campaignId).success) return { error: "Invalid campaign." };
  const w = await requireWorkspace();
  await endCampaign(serverPool(), w.workspace.id, campaignId);
  await logCampaignAction(w, "campaign.ended", campaignId);
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/campaigns");
  revalidatePath("/credits");
}
