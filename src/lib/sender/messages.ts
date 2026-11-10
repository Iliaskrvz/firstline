// Sender keys, opt-out lines and reply classification. Pure.
import { createHash, randomBytes } from "node:crypto";

/** "fl_" + 32 random bytes (base64url). Shown once; only the hash is stored. */
export function generateSenderKey(): string {
  return `fl_${randomBytes(32).toString("base64url")}`;
}

export function hashSenderKey(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex");
}

/** Safe to show later, to tell keys apart. */
export function keyPrefix(key: string): string {
  return key.trim().slice(0, 9);
}

export function looksLikeSenderKey(key: string | null | undefined): key is string {
  return !!key && /^fl_[A-Za-z0-9_-]{40,}$/.test(key.trim());
}

/** §8: every email gets an opt-out line by default. */
export const OPT_OUT_LINES: Record<"en" | "nl" | "de" | "fr", string> = {
  en: "Not relevant? Just reply 'no'.",
  nl: "Niet relevant? Antwoord gewoon 'nee'.",
  de: "Nicht relevant? Antworten Sie einfach mit 'nein'.",
  fr: "Pas pertinent ? Répondez simplement 'non'.",
};

export function defaultOptOutLine(language: string | null | undefined): string {
  return OPT_OUT_LINES[(language ?? "en") as keyof typeof OPT_OUT_LINES] ?? OPT_OUT_LINES.en;
}

/** The email as it goes out: the written email, then the opt-out line on its own paragraph. */
export function composeBody(fullEmail: string, optOutLine: string | null): string {
  const body = fullEmail.replace(/\s+$/, "");
  const line = optOutLine?.trim();
  return line ? `${body}\n\n${line}` : body;
}

/**
 * A reply that asks to stop (§8 stop rules). Sent to the Apps Script as a
 * regex source so the rule lives in one tested place. The script only reports
 * a yes/no flag, never the reply text.
 */
export const UNSUBSCRIBE_PATTERN =
  "^\\s*(no|nee|nein|non|stop|nope)\\s*[.!]?\\s*$|\\b(unsubscribe|opt[ -]?out|remove me|take me off|stop (emailing|mailing|sending)|uitschrijven|afmelden|geen interesse|niet meer (mailen|e-?mailen)|abmelden|kein interesse|désinscri\\w*|pas intéressé)(?![a-z])";

/** Where quoted history starts in a reply ("On … wrote:", "Op … schreef …:", forwarded headers). */
export const REPLY_CUT_PATTERN = "^\\s*(on .+ wrote:|op .+ schreef.*:|am .+ schrieb.*:|le .+ a écrit\\s*:|-{2,}\\s*original message|from:\\s)";

/** The reply's own text: drop quoted history and "> " lines, keep the first 1,000 chars. The Apps Script does the same. */
export function ownReplyText(plainBody: string): string {
  const cut = plainBody.search(new RegExp(REPLY_CUT_PATTERN, "im"));
  const own = (cut >= 0 ? plainBody.slice(0, cut) : plainBody)
    .split("\n")
    .filter((l) => !l.trimStart().startsWith(">"))
    .join("\n")
    .trim();
  return own.slice(0, 1000);
}

export function isUnsubscribeReply(plainBody: string): boolean {
  return new RegExp(UNSUBSCRIBE_PATTERN, "im").test(ownReplyText(plainBody));
}

/** Bounce notices come from these senders (they usually land in the original thread). */
export const BOUNCE_SENDER_PATTERN = "mailer-daemon|postmaster|mail delivery (subsystem|system)";

/**
 * One paste for the sheet: "FL1.<address, base64url>.<key>". The script stays the same for everyone;
 * when FirstLine's address changes, only the connection code does.
 */
export function connectionCode(appUrl: string, key: string): string {
  return `FL1.${Buffer.from(appUrl.trim().replace(/\/+$/, "")).toString("base64url")}.${key.trim()}`;
}

export function parseConnectionCode(code: string): { base: string; key: string } | null {
  const m = /^FL1\.([A-Za-z0-9_-]+)\.(fl_[A-Za-z0-9_-]{40,})$/.exec(code.trim());
  if (!m) return null;
  return { base: Buffer.from(m[1], "base64url").toString("utf8"), key: m[2] };
}
