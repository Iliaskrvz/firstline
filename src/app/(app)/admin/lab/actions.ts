"use server";

import { readFileSync } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { engineConfig } from "@/engine/config";
import { MAX_TEST_LEADS } from "@/engine/lab";
import { queueEvalRun, saveTestSet, upsertSkills } from "@/engine/lab-pg";
import { LIVE_SKILL_VERSION, SKILLS } from "@/engine/skills";
import { requireAdmin } from "@/lib/auth";
import { hasErrors, parseTemplate } from "@/lib/template";
import { testLeadsFromCsv } from "@/lib/test-set";
import { serverPool } from "@/server/db";

const DEFAULT_TEMPLATE = {
  subject: "{{first_name}}, quick question about {{company}}",
  body: "Hi {{first_name}},\n\n[[opener | one sentence about something specific and recent on their website | 25]]\n\nWe help teams like {{company}} write cold emails that get replies. Open to a 15-minute call next week?\n\nBest regards",
  style_rules: { language: "en" as const },
};

export async function createStarterTestSet(): Promise<void> {
  await requireAdmin();
  const { leads } = testLeadsFromCsv(readFileSync(path.join(process.cwd(), "fixtures", "lab-test-set.csv"), "utf8"));
  await saveTestSet(serverPool(), { id: "nl-starter", name: "Dutch companies (starter, 17)", template: DEFAULT_TEMPLATE, leads });
  revalidatePath("/admin/lab");
}

const NewSet = z.object({
  name: z.string().trim().min(1, "Give the test set a name.").max(80),
  csv: z.string().min(1, "Paste or upload a CSV.").max(1_000_000),
  subject: z.string().max(300),
  body: z.string().min(1).max(10_000),
});

export async function createTestSet(input: z.input<typeof NewSet>): Promise<{ error: string } | { ok: true; leads: number }> {
  const parsed = NewSet.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid test set." };
  await requireAdmin();
  const tpl = parseTemplate({ subject: parsed.data.subject, body: parsed.data.body });
  if (hasErrors(tpl) || tpl.slots.length === 0) return { error: "The template needs at least one valid [[slot]] and no errors." };
  const { leads } = testLeadsFromCsv(parsed.data.csv, MAX_TEST_LEADS);
  if (leads.length === 0) return { error: "No rows with a usable website column." };
  const id = parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `set-${leads.length}`;
  await saveTestSet(serverPool(), { id, name: parsed.data.name, template: { subject: parsed.data.subject, body: parsed.data.body }, leads });
  revalidatePath("/admin/lab");
  return { ok: true, leads: leads.length };
}

export async function startEvalRun(input: { testSetId: string; candidate: string; baseline: string }): Promise<{ error: string } | undefined> {
  await requireAdmin();
  if (!SKILLS[input.candidate] || !SKILLS[input.baseline]) return { error: "Unknown skill version." };
  const pool = serverPool();
  await upsertSkills(pool, LIVE_SKILL_VERSION);
  await queueEvalRun(pool, { ...input, provider: engineConfig().llmProvider });
  revalidatePath("/admin/lab");
}
