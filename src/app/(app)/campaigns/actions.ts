"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/auth";
import { applyMapping, mappingErrors, MAX_ROWS, type ColumnTarget } from "@/lib/csv";

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
