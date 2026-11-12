// Request bodies for /api/v1 (zod). Kept in one place: the OpenAPI file mirrors these.
import { z } from "zod";

/** Max leads per batch call (decision 2026-11-11). */
export const MAX_BATCH = 100;
/** Max seconds a call may wait for the result. */
export const MAX_WAIT_S = 60;
/** Requests per minute per API key (decision 2026-11-11). */
export const RATE_LIMIT_PER_MIN = 60;

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullish().transform((v) => (v ? v : null));

export const LeadInput = z.object({
  email: z.email("lead.email must be a valid email address").max(254),
  first_name: optText(100),
  last_name: optText(100),
  company: optText(200),
  title: optText(200),
  website: optText(500),
  linkedin_headline: optText(500),
  custom: z.record(z.string().max(60), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])).optional(),
});
export type LeadInput = z.infer<typeof LeadInput>;

export const CopyInput = z.object({
  subject: z.string().max(300).default(""),
  body: z.string().min(1, "copy.body is required").max(10_000),
  style_rules: z
    .object({
      language: z.enum(["auto", "en", "nl", "de", "fr"]).default("auto"),
      tone: z.string().trim().max(200).default(""),
      banned_phrases: z.array(z.string().trim().max(200)).max(50).default([]),
      extra_rules: z.array(z.string().trim().max(300)).max(20).default([]),
    })
    .optional(),
});

export const Options = z
  .object({
    writer: z.enum(["pro", "lite"]).default("pro"),
    depth: z
      .object({
        deep: z.boolean().default(false),
        local: z.literal(false, "Local research isn't offered.").optional(),
      })
      .default({ deep: false }),
  })
  .default({ writer: "pro", depth: { deep: false } });

const source = {
  copy: CopyInput.optional(),
  campaign_id: z.uuid().optional(),
  options: Options,
  // No-code tools may send numbers as text ("45") or leave the field empty.
  wait: z.preprocess((v) => (v === "" || v == null ? undefined : typeof v === "string" ? Number(v) : v), z.number().int().min(0).max(MAX_WAIT_S).default(0)),
};

export const PersonalizeBody = z.object({ lead: LeadInput, ...source });
export const BatchBody = z.object({ leads: z.array(LeadInput).min(1).max(MAX_BATCH, `At most ${MAX_BATCH} leads per batch.`), ...source });
export type PersonalizeBody = z.infer<typeof PersonalizeBody>;
export type BatchBody = z.infer<typeof BatchBody>;

/**
 * No-code tools (Make, Zapier) send every mapped field, empty or not. Before validation:
 * an empty campaign_id is absent, and copy without a body is absent when a campaign_id is given.
 */
export function normaliseSource(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const b = { ...(raw as Record<string, unknown>) };
  if (b.campaign_id === "" || b.campaign_id === null) delete b.campaign_id;
  const copy = b.copy as Record<string, unknown> | null | undefined;
  const emptyCopy = copy == null || (typeof copy === "object" && !String(copy.body ?? "").trim());
  if (emptyCopy && b.campaign_id) delete b.copy;
  if (copy === null) delete b.copy;
  return b;
}

/** Zod error → one readable line plus the field path. */
export function zodMessage(e: z.ZodError): { message: string; field: string } {
  const i = e.issues[0];
  const field = i?.path.join(".") ?? "";
  return { message: i ? (i.message.includes(field) || !field ? i.message : `${field}: ${i.message}`) : "Invalid request", field };
}
