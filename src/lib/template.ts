// Template syntax (§2, §10):
//   {{first_name}}                          plain mail-merge variable
//   [[opener · what to write · 25]]         AI-written slot: name · instruction · max words
//   [[bridge | one sentence about us]]      "|" works as a separator too; whitespace is trimmed
//   [[SLOT · instruction · 20]]             literal "SLOT" -> auto-named slot_1, slot_2, ...
// Rules: name required and unique (letters, digits, _); instruction required;
// max words optional, default 25, range 3–80.
// Everything outside the markers is the user's copy and is never changed.

export type Slot = {
  key: string;
  instruction: string;
  max_words: number;
};

export type Token =
  | { type: "text"; value: string }
  | { type: "var"; key: string; raw: string }
  | { type: "slot"; key: string; raw: string };

export type Part = "subject" | "body";

export type TemplateIssue = {
  level: "error" | "warning";
  message: string;
  /** Where it is, so the editor can show it inline. */
  part?: Part;
  line?: number;
};

export type ParsedTemplate = {
  subject: Token[];
  body: Token[];
  variables: string[];
  slots: Slot[];
  issues: TemplateIssue[];
};

export const DEFAULT_MAX_WORDS = 25;
export const MIN_MAX_WORDS = 3;
export const MAX_MAX_WORDS = 80;

const SLOT_NAME = /^[a-z0-9_]{1,40}$/;
const VAR_NAME = /^[a-z0-9_]{1,40}$/;
const SEPARATOR = /\s*[·|]\s*/;
const WORD_LIMIT = /^(\d+)\s*(?:words?|woorden|wörter)?$/i;

type RawToken =
  | { type: "text"; value: string }
  | { type: "var" | "slot"; inner: string; raw: string; line: number };

const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

function scan(text: string, part: Part, issues: TemplateIssue[]): RawToken[] {
  const out: RawToken[] = [];
  const label = part === "subject" ? "Subject" : "Body";
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
      const line = lineAt(text, i);
      if (end === -1 || nextOpen < end) {
        const snippet = text.slice(i, i + 24).split("\n")[0];
        issues.push({
          level: "error",
          part,
          line,
          message: `${label}, line ${line}: "${snippet}…" is missing its closing "${close}".`,
        });
        i += 2;
        continue;
      }
      pushText(i);
      out.push({ type: two === "[[" ? "slot" : "var", inner: text.slice(i + 2, end), raw: text.slice(i, end + 2), line });
      i = end + 2;
      textStart = i;
      continue;
    }
    if (two === "]]" || two === "}}") {
      const line = lineAt(text, i);
      issues.push({
        level: "error",
        part,
        line,
        message: `${label}, line ${line}: "${two}" without a matching "${two === "]]" ? "[[" : "{{"}".`,
      });
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

  const resolve = (raw: RawToken[], part: Part): Token[] =>
    raw.map((t): Token => {
      if (t.type === "text") return t;
      const label = part === "subject" ? "Subject" : "Body";
      const at = `${label}, line ${t.line}`;
      const err = (message: string) => issues.push({ level: "error", part, line: t.line, message: `${at}: ${message}` });

      if (t.type === "var") {
        const key = t.inner.trim().toLowerCase();
        if (!VAR_NAME.test(key)) err(`"${t.raw}" is not a valid variable. Use letters, digits and _ only, e.g. {{first_name}}.`);
        else if (!variables.includes(key)) variables.push(key);
        return { type: "var", key, raw: t.raw };
      }

      const parts = t.inner.split(SEPARATOR).map((p) => p.trim());
      let key = (parts.shift() ?? "").toLowerCase();
      if (!key) {
        err(`"${t.raw}" has no name. Write it as [[name · instruction · max words]].`);
        return { type: "slot", key: "", raw: t.raw };
      }
      if (key === "slot") key = `slot_${++autoSlot}`;
      if (!SLOT_NAME.test(key)) {
        err(`slot name "${key}" can only use letters, digits and _ (no spaces).`);
        return { type: "slot", key, raw: t.raw };
      }

      let maxWords = DEFAULT_MAX_WORDS;
      const last = parts[parts.length - 1];
      const num = parts.length > 0 ? last.match(WORD_LIMIT) : null;
      if (num) {
        parts.pop();
        maxWords = Number(num[1]);
        if (maxWords < MIN_MAX_WORDS || maxWords > MAX_MAX_WORDS) {
          err(`slot "${key}" has max ${maxWords} words; use ${MIN_MAX_WORDS}–${MAX_MAX_WORDS}.`);
        }
      }
      const instruction = parts.filter(Boolean).join(" · ");
      if (!instruction) err(`slot "${key}" needs an instruction, e.g. [[${key} · mention something specific from their website · 25]].`);

      if (slots.some((s) => s.key === key)) {
        err(`slot name "${key}" is used twice. Each slot needs its own name.`);
      } else {
        slots.push({ key, instruction, max_words: maxWords });
      }
      return { type: "slot", key, raw: t.raw };
    });

  const subject = resolve(scan(input.subject, "subject", issues), "subject");
  const body = resolve(scan(input.body, "body", issues), "body");

  if (!input.body.trim()) {
    issues.push({ level: "error", part: "body", message: "The email body is empty." });
  } else if (slots.length === 0 && !hasErrors({ issues })) {
    issues.push({ level: "warning", part: "body", message: "No slots yet, so there's nothing for FirstLine to personalise. Use “+ Add slot”." });
  }
  if (!input.subject.trim()) issues.push({ level: "warning", part: "subject", message: "The subject is empty." });

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

// ---------------------------------------------------------------------------
// "+ Add slot" helpers
// ---------------------------------------------------------------------------

const SUGGESTED_NAMES = ["opener", "bridge", "ps"];

/** First free name: opener, bridge, ps, then slot_2, slot_3, ... */
export function suggestSlotName(existing: string[]): string {
  const used = new Set(existing);
  const free = SUGGESTED_NAMES.find((n) => !used.has(n));
  if (free) return free;
  let n = 2;
  while (used.has(`slot_${n}`)) n++;
  return `slot_${n}`;
}

export type SlotDraft = { key: string; instruction: string; max_words: number | string };

/** Validates the Add-slot form. Returns field errors (empty = OK). */
export function validateSlotDraft(d: SlotDraft, existing: string[]): Partial<Record<keyof SlotDraft, string>> {
  const errors: Partial<Record<keyof SlotDraft, string>> = {};
  const key = d.key.trim().toLowerCase();
  if (!key) errors.key = "Give the slot a name.";
  else if (!SLOT_NAME.test(key)) errors.key = "Letters, digits and _ only.";
  else if (key === "slot") errors.key = "Pick a more specific name.";
  else if (existing.includes(key)) errors.key = "This name is already used.";
  if (!d.instruction.trim()) errors.instruction = "Say what this slot should do.";
  else if (/[[\]{}|·]/.test(d.instruction)) errors.instruction = "Leave out [ ] { } | and ·.";
  const mw = Number(d.max_words);
  if (!Number.isInteger(mw) || mw < MIN_MAX_WORDS || mw > MAX_MAX_WORDS) errors.max_words = `${MIN_MAX_WORDS}–${MAX_MAX_WORDS}`;
  return errors;
}

/** The exact text the Add-slot form inserts. */
export function formatSlot(d: SlotDraft): string {
  return `[[${d.key.trim().toLowerCase()} · ${d.instruction.trim().replace(/\s+/g, " ")} · ${Number(d.max_words)}]]`;
}

// ---------------------------------------------------------------------------

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
