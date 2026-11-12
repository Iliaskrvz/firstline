// Validation (§7): plan check + rule checks, all in code. The AI judge is separate.
import { countWords, type Slot } from "@/lib/template";
import { CTA_TYPES, MOVES, type CheckItem, type Fact, type Language, type WriterOutput } from "./types";

export const BANNED: Record<Language | "all", string[]> = {
  all: ["!", "game-changer", "game changer", "synergy", "revolutionary", "cutting-edge", "world-class", "best-in-class", "hormozi", "girard"],
  en: [
    "i hope this finds you well", "hope this finds you well", "hope you're doing well", "hope you are doing well", "i came across",
    "came across your", "saw your headline", "love your website", "great website", "amazing website", "impressive website",
    "i noticed your website", "just checking in", "touch base", "book a call", "30 minutes", "30-minute", "quick call", "hop on a call",
  ],
  nl: [
    "ik hoop dat alles goed", "hoop dat het goed met je gaat", "ik kwam je", "ik kwam jullie", "ik kwam uw", "kwam je profiel",
    "mooie website", "prachtige website", "geweldige website", "zag je headline", "baanbrekend", "revolutionair",
    "even sparren", "belafspraak", "30 minuten", "kort gesprek inplannen",
  ],
  de: ["ich hoffe, es geht ihnen gut", "ich bin auf ihr", "tolle website", "schöne website", "bahnbrechend", "revolutionär", "30 minuten"],
  fr: ["j'espère que vous allez bien", "je suis tombé sur", "superbe site", "révolutionnaire", "30 minutes"],
};

const SPAM = [
  "free", "guarantee", "guaranteed", "act now", "limited time", "100%", "risk-free", "click here", "winner", "$$$", "urgent",
  "gratis", "garantie", "nu actie", "klik hier", "kostenlos", "jetzt handeln", "gratuit",
];

// Tier-✕: never personal life. Hard block.
export const FORBIDDEN_TOPICS = [
  // Family: only when it's about the reader ("your kids"), so a company's cause ("child labour") isn't blocked.
  /\b(your|you and your)\s+(wife|husband|partner|kids?|children|son|daughter|baby|family)\b/i,
  /\b(pregnan\w*|married|divorce\w*|honeymoon)\b/i,
  /\b(je|jouw|jullie|uw)\s+(vrouw|man|partner|kinderen|kids|zoon|dochter|baby|gezin|familie)\b/i,
  /\b(zwanger|getrouwd|gescheiden|huwelijksreis)\b/i,
  /\b(ihre?|deine?)\s+(frau|mann|kinder|sohn|tochter|familie)\b/i,
  /\b(schwanger|verheiratet|geschieden)\b/i,
  /\b(your|je|jouw|uw|ihre?)\s+(health|illness|gezondheid|ziekte|gesundheit)\b/i,
  /\b(sick leave|cancer|diagnos\w*|surgery|kanker|ziekenhuisopname|chemo\w*|krankheit)\b/i,
  /\b(church|mosque|religio\w*|kerk|moskee|geloof|kirche|politic\w*|politiek\w*|politisch\w*|election|verkiezing\w*)\b/i,
  /\b(\d{2}\s?(years old|jaar oud|jahre alt)|birthday|verjaardag|geburtstag)\b/i,
  /\b(instagram|tiktok|facebook|snapchat)\b/i,
  /\b(your home|bij je thuis|in je woonplaats|where you live|waar je woont)\b/i,
];

const YOU: Record<Language, RegExp> = {
  en: /\b(you|your|yours|you're|you've)\b/gi,
  nl: /\b(je|jij|jou|jouw|jullie|u|uw)\b/gi,
  de: /\b(du|dein\w*|ihr|euer|eure\w*|sie|ihnen|ihre?\w*)\b/gi,
  fr: /\b(vous|votre|vos|tu|ton|ta|tes)\b/gi,
};
const WE: Record<Language, RegExp> = {
  en: /\b(we|our|ours|us|we're|we've|i|my|me|i'm)\b/gi,
  nl: /\b(wij|we|ons|onze|ik|mijn|mij)\b/gi,
  de: /\b(wir|uns|unser\w*|ich|mein\w*|mir|mich)\b/gi,
  fr: /\b(nous|notre|nos|je|mon|ma|mes)\b/gi,
};

const STOPWORDS = new Set([
  ...["the", "and", "with", "that", "this", "from", "your", "their", "have", "been", "they", "into", "about", "more", "also", "which"],
  ...["voor", "met", "zijn", "hebben", "jullie", "deze", "door", "naar", "over", "onze", "heeft", "wordt", "worden", "ook", "maar", "niet"],
  ...["und", "eine", "einen", "sind", "haben", "nicht", "auch", "für", "mit", "über"],
]);

const contentWords = (s: string) =>
  new Set((s.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((w) => !STOPWORDS.has(w)).map((w) => w.slice(0, 6)));

/** Numbers written in a slot must appear in the cited facts. */
const numbersIn = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));

export type CheckContext = {
  slots: Slot[];
  facts: Fact[];
  language: Language;
  skillVersion: string;
  extraBanned?: string[];
  /** The company's own name doesn't count as "reflecting" a fact: it's in every fact. */
  company?: string | null;
};

export function planCheck(out: WriterOutput, ctx: CheckContext): CheckItem[] {
  const ids = new Set(ctx.facts.map((f) => f.id));
  const items: CheckItem[] = [];
  const moves = out.plan.move ?? [];
  const badMoves = moves.filter((m) => !(MOVES as readonly string[]).includes(m));
  items.push({
    id: "plan_moves",
    label: "Plan uses 1–2 allowed moves",
    pass: badMoves.length === 0 && moves.length >= 1 && moves.length <= 2,
    detail: badMoves.length ? `Unknown: ${badMoves.join(", ")}` : moves.length > 2 ? "More than 2 moves" : moves.length === 0 ? "No move" : undefined,
  });
  items.push({
    id: "plan_cta",
    label: "CTA type is allowed",
    pass: (CTA_TYPES as readonly string[]).includes(out.plan.cta_type),
    detail: (CTA_TYPES as readonly string[]).includes(out.plan.cta_type) ? undefined : `Got "${out.plan.cta_type}"`,
  });
  const unknown = [out.plan.angle, ...out.facts_used].filter((id) => !ids.has(id));
  items.push({
    id: "plan_facts_exist",
    label: "Every cited fact ID exists",
    pass: unknown.length === 0 && out.facts_used.length > 0,
    detail: unknown.length ? `Unknown: ${[...new Set(unknown)].join(", ")}` : out.facts_used.length ? undefined : "No facts cited",
  });
  const angle = ctx.facts.find((f) => f.id === out.plan.angle);
  const opener = out.slots.opener ?? out.slots[ctx.slots[0]?.key ?? ""] ?? "";
  const nameWords = contentWords(ctx.company ?? "");
  const overlap = angle ? [...contentWords(angle.text)].filter((w) => !nameWords.has(w) && contentWords(opener).has(w)) : [];
  items.push({
    id: "plan_angle_in_opener",
    label: "The angle fact is reflected in the opener",
    pass: overlap.length > 0,
    detail: overlap.length ? undefined : angle ? `Opener doesn't mention ${angle.id}` : "Angle fact missing",
  });
  if (angle?.tier === "C") {
    items.push({ id: "plan_angle_tier", label: "Opener angle comes from the company, not the role", pass: false, detail: "Angle is a tier C (CSV role) fact" });
  }
  const expected = ctx.slots.map((s) => s.key).sort();
  const got = Object.keys(out.slots).sort();
  items.push({
    id: "plan_slots_match",
    label: "Exactly the template's slots were written",
    pass: JSON.stringify(expected) === JSON.stringify(got),
    detail: JSON.stringify(expected) === JSON.stringify(got) ? undefined : `Expected ${expected.join(", ")}; got ${got.join(", ")}`,
  });
  return items;
}

export function ruleChecks(out: WriterOutput, ctx: CheckContext): CheckItem[] {
  const items: CheckItem[] = [];
  const all = Object.values(out.slots).join(" ");
  const lower = all.toLowerCase();

  for (const s of ctx.slots) {
    const text = out.slots[s.key] ?? "";
    const words = countWords(text);
    items.push({ id: `words_${s.key}`, label: `“${s.key}” ≤ ${s.max_words} words`, pass: words <= s.max_words && words > 0, detail: `${words} words` });
    const questions = (text.match(/\?/g) ?? []).length;
    items.push({ id: `questions_${s.key}`, label: `“${s.key}” has at most 1 question`, pass: questions <= 1, detail: questions > 1 ? `${questions} questions` : undefined });
  }

  const banned = [...BANNED.all, ...BANNED[ctx.language], ...(ctx.extraBanned ?? []).map((b) => b.toLowerCase())];
  const hits = banned.filter((b) => b !== "!" && lower.includes(b));
  items.push({ id: "banned", label: "No banned phrases", pass: hits.length === 0, detail: hits.length ? hits.join(", ") : undefined });
  items.push({ id: "exclamation", label: "No exclamation marks", pass: !all.includes("!") });
  const link = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|nl|de|be|io|co|org|net|eu)\b)/i.test(all);
  items.push({ id: "links", label: "No links", pass: !link });
  const spam = SPAM.filter((w) => new RegExp(`(^|\\W)${w.replace(/[$%]/g, "\\$&")}(\\W|$)`, "i").test(all));
  items.push({ id: "spam", label: "No spam words", pass: spam.length === 0, detail: spam.length ? spam.join(", ") : undefined });

  const you = (all.match(YOU[ctx.language]) ?? []).length;
  const we = (all.match(WE[ctx.language]) ?? []).length;
  items.push({ id: "you_we", label: "More “you” than “we”", pass: you >= we, detail: `you ${you} · we ${we}` });

  const forbidden = FORBIDDEN_TOPICS.map((r) => all.match(r)?.[0]).filter(Boolean) as string[];
  items.push({ id: "tier_x", label: "No personal or private topics", pass: forbidden.length === 0, detail: forbidden.length ? forbidden.join(", ") : undefined });

  const cited = ctx.facts.filter((f) => out.facts_used.includes(f.id)).map((f) => f.text).join(" ");
  const factNums = new Set(numbersIn(cited));
  const strayNums = numbersIn(all).filter((n) => !factNums.has(n));
  items.push({ id: "numbers", label: "Numbers only from cited facts", pass: strayNums.length === 0, detail: strayNums.length ? strayNums.join(", ") : undefined });

  const usesReview = ctx.facts.some((f) => f.tier === "B" && out.facts_used.includes(f.id));
  if (usesReview) items.push({ id: "tier_b_quote", label: "Review themes are not quoted", pass: !/["“”„]/.test(all) });
  return items;
}

export function allPass(items: CheckItem[]) {
  return items.every((i) => i.pass);
}

export function failureReasons(items: CheckItem[]): string[] {
  return items.filter((i) => !i.pass).map((i) => (i.detail ? `${i.label} (${i.detail})` : i.label));
}

/** True when a text touches a never-topic (personal life, health, religion, politics …). */
export function touchesForbiddenTopic(text: string): boolean {
  return FORBIDDEN_TOPICS.some((re) => re.test(text));
}
