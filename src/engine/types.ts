// Shared engine types. No framework imports here (pg-boss, Next, Supabase).
import type { Slot } from "@/lib/template";
import type { StyleRules } from "@/lib/types";

export type PageType = "home" | "about" | "services" | "news" | "careers";

export type PickedPage = { url: string; type: PageType };

export type ScrapedPage = PickedPage & { markdown: string; md_hash: string; title?: string };

/** A: website, B: review themes, C: role facts from the CSV, D: confirmed public mentions. */
export type FactTier = "A" | "B" | "C" | "D";

export type Fact = { id: string; text: string; src: string; tier: FactTier };

/** blocked = robots.txt says no; refused = the site answered 401/403 (bot protection). */
export type ResearchStatus = "ok" | "unreachable" | "blocked" | "refused" | "no_content";

export const MOVES = ["value_stack", "genuine_interest", "cost_of_inaction", "proof", "no_oriented_ask", "risk_reversal"] as const;
export type Move = (typeof MOVES)[number];
export const CTA_TYPES = ["interest", "soft_question"] as const;
export type CtaType = (typeof CTA_TYPES)[number];

export type Plan = { angle: string; pain: string; move: Move[]; cta_type: CtaType };

export type WriterOutput = {
  plan: Plan;
  slots: Record<string, string>;
  facts_used: string[];
  skill_version: string;
};

export type JudgeScores = {
  relevance: number;
  specificity: number;
  value_clarity: number;
  cta_effort: number;
  sounds_human: number;
  would_reply: number;
  claims_supported: boolean;
  unsupported_claims: string[];
};

export type Language = "en" | "nl" | "de" | "fr";

export type LeadJob = {
  lead: {
    id: string;
    workspace_id: string;
    campaign_id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    title: string | null;
    linkedin_headline: string | null;
    website: string | null;
    domain: string | null;
    custom: Record<string, string>;
    status: string;
  };
  campaign: { id: string; writer: "pro" | "lite"; depth: { deep: boolean; local: boolean }; status?: string };
  template: { id: string; subject: string; body: string; slots: Slot[]; style_rules: StyleRules; examples: unknown[] } | null;
  /** Personalised follow-up steps (2, 3, …), written right after step 1 from the same facts. */
  followUps?: { step_no: number; body: string }[];
};

/** One provider call, as logged to usage_costs. */
export type CostEntry = {
  step: "scrape" | "extract" | "write" | "validate" | "judge" | "search" | "places";
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  provider_units?: number;
  cost_usd: number;
};

export type CheckItem = { id: string; label: string; pass: boolean; detail?: string };
