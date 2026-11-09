"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/auth";
import { hasErrors, parseTemplate } from "@/lib/template";

const lines = z.array(z.string().trim().min(1).max(200)).max(50);

const TemplateInput = z.object({
  id: z.uuid().nullable(),
  campaignId: z.uuid().nullable(),
  name: z.string().trim().min(1, "Give the template a name.").max(120),
  subject: z.string().max(300),
  body: z.string().max(10_000),
  style_rules: z.object({
    language: z.enum(["auto", "en", "nl", "de", "fr"]),
    tone: z.string().trim().max(200),
    banned_phrases: lines,
    extra_rules: lines,
  }),
});

export type SaveTemplateResult = { error: string } | { ok: true; id: string } | undefined;

export async function saveTemplate(input: z.input<typeof TemplateInput>): Promise<SaveTemplateResult> {
  const parsed = TemplateInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid template." };
  const { id, campaignId, name, subject, body, style_rules } = parsed.data;

  // Slots are always derived on the server from the body, never sent by the client.
  const tpl = parseTemplate({ subject, body });
  if (hasErrors(tpl)) return { error: tpl.issues.find((i) => i.level === "error")!.message };

  const { supabase, workspace } = await requireWorkspace();
  const row = { name, subject, body, slots: tpl.slots, style_rules };

  let templateId = id;
  if (id) {
    const { error } = await supabase.from("templates").update(row).eq("id", id);
    if (error) return { error: error.message };
  } else {
    const { data, error } = await supabase
      .from("templates")
      .insert({ ...row, workspace_id: workspace.id })
      .select("id")
      .single();
    if (error || !data) return { error: error?.message ?? "Could not save." };
    templateId = data.id;
  }

  revalidatePath("/templates");
  if (campaignId) {
    const { error } = await supabase.from("campaigns").update({ template_id: templateId }).eq("id", campaignId);
    if (error) return { error: error.message };
    revalidatePath(`/campaigns/${campaignId}`);
    redirect(`/campaigns/${campaignId}`);
  }
  if (!id) redirect(`/templates/${templateId}`);
  return { ok: true, id: templateId! };
}
