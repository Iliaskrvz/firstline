// Neutral fallback (§1): used when research finds nothing usable or validation
// fails twice. Costs 0 credits. Only the first slot gets a neutral line; the
// other slots are left out, so no claim about the lead is ever invented.
import type { Slot } from "@/lib/template";
import type { Language } from "./types";

const NEUTRAL: Record<Language, string> = {
  en: "I'll keep this short.",
  nl: "Ik houd het kort.",
  de: "Ich fasse mich kurz.",
  fr: "Je serai bref.",
};

export function fallbackSlots(slots: Slot[], language: Language): Record<string, string> {
  return Object.fromEntries(slots.map((s, i) => [s.key, i === 0 ? NEUTRAL[language] : ""]));
}

export const FALLBACK_REASONS = {
  no_website: "No website in the CSV",
  unreachable: "Website unreachable",
  blocked: "Website asks robots not to read these pages",
  no_content: "Website had no readable content",
  no_facts: "No usable facts found on the website",
  failed_checks: "Didn't pass the checks after one rewrite",
  refusal: "The model declined to write this one",
} as const;
export type FallbackReason = keyof typeof FALLBACK_REASONS;
