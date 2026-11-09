// Template syntax (§2, §10):
//   {{first_name}}                          plain mail-merge variable
//   [[opener · what to write · 25]]         AI-written slot: key · instruction · max words
//   [[bridge | one sentence linking to us]] "|" works as a separator too
//   [[SLOT · instruction · 20]]             literal "SLOT" -> auto-named slot_1, slot_2, ...
// Everything outside the markers is the user's copy and is never changed.

export type Slot = {
  key: string;
  instruction: string;
  max_words: number | null;
};

export type Token =
  | { type: "text"; value: string }
  | { type: "var"; key: string; raw: string }
  | { type: "slot"; key: string; raw: string };

export type TemplateIssue = { level: "error" | "warning"; message: string };

export type ParsedTemplate = {
  subject: Token[];
  body: Token[];
  variables: string[];
  slots: Slot[];
  issues: TemplateIssue[];
};

/** Default word limits per slot key (§6 Layer 1). null = no word limit (sentence rules apply). */
export const DEFAULT_MAX_WORDS: Record<string, number> = { opener: 25 };
export const MAX_WORDS_LIMIT = 150;

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const SEPARATOR = /\s*[·|]\s*/;

type RawToken =
  | { type: "text"; value: string }
  | { type: "var"; inner: string; raw: string }
  | { type: "slot"; inner: string; raw: string };

function scan(text: string, where: string, issues: TemplateIssue[]): RawToken[] {
  const out: RawToken[] = [];
  let i = 0;
  let textStart = 0;
  const pushText = (end: number) => {
    if (end > textStart) out.push({ type: "text", value: text.slice(textStart, end) });
  };

  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === "[[" || two === "{{") {
      const close = two === "[[" ? "]]" : "}}";
      const end = text.indexOf(close, i + 2);
      const nextOpen = Math.min(
        ...["[[", "{{"].map((o) => {
          const p = text.indexOf(o, i + 2);
          return p === -1 ? Infinity : p;
        }),
      );
      if (end === -1 || nextOpen < end) {
        issues.push({
          level: "error",
          message: `${where}: "${two}" at position ${i + 1} is never closed with "${close}".`,
        });
        i += 2;
        continue;
      }
      pushText(i);
      const raw = text.slice(i, end + 2);
      const inner = text.slice(i + 2, end);
      out.push(two === "[[" ? { type: "slot", inner, raw } : { type: "var", inner, raw });
      i = end + 2;
      textStart = i;
      continue;
    }
    if (two === "]]" || two === "}}") {
      issues.push({ level: "error", message: `${where}: stray "${two}" at position ${i + 1}.` });
      i += 2;
      continue;
    }
    i++;
  }
  pushText(text.length);
  return out;
}

export function parseTemplate(
  input: { subject: string; body: string },
  opts: { availableVariables?: string[] } = {},
): ParsedTemplate {
  const issues: TemplateIssue[] = [];
  const slots: Slot[] = [];
  const variables: string[] = [];
  let autoSlot = 0;

  const resolve = (raw: RawToken[], where: string): Token[] =>
    raw.map((t): Token => {
      if (t.type === "text") return t;

      if (t.type === "var") {
        const key = t.inner.trim().toLowerCase();
        if (!KEY.test(key)) {
          issues.push({ level: "error", message: `${where}: "${t.raw}" is not a valid variable name (use letters, numbers and _).` });
        } else if (!variables.includes(key)) {
          variables.push(key);
        }
        return { type: "var", key, raw: t.raw };
      }

      const parts = t.inner.split(SEPARATOR).map((p) => p.trim());
      let key = (parts.shift() ?? "").toLowerCase();
      if (!key) {
        issues.push({ level: "error", message: `${where}: empty slot "${t.raw}". Write it as [[name · instruction · max words]].` });
        return { type: "slot", key: "", raw: t.raw };
      }
      if (key === "slot") key = `slot_${++autoSlot}`;
      if (!KEY.test(key)) {
        issues.push({ level: "error", message: `${where}: slot name "${key}" must start with a letter and use only letters, numbers and _.` });
        return { type: "slot", key, raw: t.raw };
      }

      let maxWords: number | null = DEFAULT_MAX_WORDS[key] ?? null;
      const last = parts[parts.length - 1];
      const num = last?.match(/^(\d+)\s*(?:words?|woorden|wörter)?$/i);
      if (num) {
        parts.pop();
        maxWords = Number(num[1]);
        if (maxWords < 1 || maxWords > MAX_WORDS_LIMIT) {
          issues.push({ level: "error", message: `Slot "${key}": max words must be between 1 and ${MAX_WORDS_LIMIT}.` });
        }
      }
      const instruction = parts.filter(Boolean).join(" · ");

      if (slots.some((s) => s.key === key)) {
        issues.push({ level: "error", message: `Slot "${key}" is used twice. Each slot needs its own name.` });
      } else {
        if (!instruction) {
          issues.push({ level: "warning", message: `Slot "${key}" has no instruction. Say what it should do, e.g. [[${key} · mention something specific from their website · 25]].` });
        }
        slots.push({ key, instruction, max_words: maxWords });
      }
      return { type: "slot", key, raw: t.raw };
    });

  const subject = resolve(scan(input.subject, "Subject", issues), "Subject");
  const body = resolve(scan(input.body, "Body", issues), "Body");

  if (!input.body.trim()) {
    issues.push({ level: "error", message: "The email body is empty." });
  } else if (slots.length === 0) {
    issues.push({ level: "warning", message: "No [[slots]] yet, so there's nothing for FirstLine to personalise. Add e.g. [[opener · a line about their company · 25]]." });
  }
  if (!input.subject.trim()) issues.push({ level: "warning", message: "The subject is empty." });

  if (opts.availableVariables) {
    const known = new Set(opts.availableVariables);
    const unknown = variables.filter((v) => !known.has(v));
    if (unknown.length) {
      issues.push({
        level: "warning",
        message: `Not in your lead list: ${unknown.map((v) => `{{${v}}}`).join(", ")}. These will be empty.`,
      });
    }
  }

  return { subject, body, variables, slots, issues };
}

export function hasErrors(p: Pick<ParsedTemplate, "issues">): boolean {
  return p.issues.some((i) => i.level === "error");
}

/**
 * Fill a token list. Variables come from the lead; slots from the AI. Missing
 * slot values are rendered by `missingSlot` (default: keep the raw marker).
 */
export function render(
  tokens: Token[],
  vars: Record<string, string | null | undefined>,
  slotValues: Record<string, string> = {},
  missingSlot: (key: string, raw: string) => string = (_k, raw) => raw,
): string {
  return tokens
    .map((t) => {
      if (t.type === "text") return t.value;
      if (t.type === "var") return vars[t.key] ?? "";
      return slotValues[t.key] ?? missingSlot(t.key, t.raw);
    })
    .join("");
}

/** Word count used for max_words checks. */
export function countWords(s: string): number {
  const m = s.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
  return m ? m.length : 0;
}
