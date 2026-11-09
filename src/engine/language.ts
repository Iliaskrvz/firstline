import type { Language } from "./types";

const STOP: Record<Language, string[]> = {
  en: ["the", "and", "you", "your", "we", "our", "with", "for", "that", "this", "are", "is", "to", "of"],
  nl: ["de", "het", "een", "en", "je", "jij", "jullie", "wij", "we", "onze", "met", "voor", "dat", "is", "van", "niet", "ik"],
  de: ["der", "die", "das", "und", "sie", "ihr", "wir", "unser", "mit", "für", "dass", "ist", "nicht", "ich", "ein"],
  fr: ["le", "la", "les", "et", "vous", "votre", "nous", "notre", "avec", "pour", "que", "est", "une", "des"],
};

/** Language of the user's own copy (variables and slots are ignored). */
export function detectLanguage(text: string, fallback: Language = "en"): Language {
  const words = text
    .replace(/\[\[[\s\S]*?\]\]|\{\{[\s\S]*?\}\}/g, " ")
    .toLowerCase()
    .match(/\p{L}+/gu) ?? [];
  let best: Language = fallback;
  let bestScore = 0;
  for (const lang of Object.keys(STOP) as Language[]) {
    const set = new Set(STOP[lang]);
    const score = words.filter((w) => set.has(w)).length;
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : fallback;
}
