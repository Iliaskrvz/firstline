// Strict JSON schemas for every model call (zod -> structured outputs).
import { z } from "zod";
import { CTA_TYPES, MOVES } from "./types";

export const FactsSchema = z.object({
  facts: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      src: z.string(),
      tier: z.enum(["A"]),
    }),
  ),
});
export type FactsOutput = z.infer<typeof FactsSchema>;

export function writerSchema(slotKeys: string[]) {
  return z.object({
    plan: z.object({
      angle: z.string(),
      pain: z.string(),
      move: z.array(z.enum(MOVES)),
      cta_type: z.enum(CTA_TYPES),
    }),
    slots: z.object(Object.fromEntries(slotKeys.map((k) => [k, z.string()]))),
    facts_used: z.array(z.string()),
    skill_version: z.string(),
  });
}

const score = z.number().int();
export const JudgeSchema = z.object({
  relevance: score,
  specificity: score,
  value_clarity: score,
  cta_effort: score,
  sounds_human: score,
  would_reply: score,
  claims_supported: z.boolean(),
  unsupported_claims: z.array(z.string()),
});

/** Validates fact output from any extractor (also the fake one). */
export function sanitiseFacts(facts: { id: string; text: string; src: string; tier: string }[], pageUrls: string[]) {
  const urls = new Set(pageUrls);
  return facts
    .filter((f) => f.text.trim() && urls.has(f.src))
    .slice(0, 6)
    .map((f, i) => ({ id: `F${i + 1}`, text: f.text.trim().replace(/\s+/g, " "), src: f.src, tier: "A" as const }));
}
