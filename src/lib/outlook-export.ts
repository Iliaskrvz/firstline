// "Download for Outlook" (Phase O1): a ZIP with one .eml draft per lead (and optionally per follow-up
// step), a README in English and Dutch, and optionally a mail-merge CSV. Pure: no database, no network.
//
// The .eml files: To, Subject, X-Unsent: 1 (Outlook's convention for "open as an unsent draft"; widely
// used but not documented by Microsoft), no From (so Outlook picks the account), a plain-text and an
// HTML part (multipart/alternative, UTF-8, base64), CRLF line endings. Nothing else.
import { strToU8, zipSync } from "fflate";
import Papa from "papaparse";

export type OutlookDraft = {
  to: string;
  /** Name for the To header and the file name. */
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  subject: string;
  /** The full email as plain text, opt-out line included. */
  text: string;
};

export type OutlookLead = {
  first: OutlookDraft;
  /** Follow-up steps (2, 3, …) as separate drafts; not threaded replies. */
  followUps: { step: number; draft: OutlookDraft }[];
};

const CRLF = "\r\n";

/** RFC 2047 encoded-word for non-ASCII header text (base64, UTF-8), split so no line gets too long. */
export function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  const words: string[] = [];
  let chunk = "";
  for (const ch of clean) {
    // ~45 bytes of UTF-8 per encoded word keeps each line under 76 characters.
    if (Buffer.byteLength(chunk + ch, "utf8") > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join(`${CRLF} `);
}

/** "Sanne de Vos <sanne@x.nl>", with the name encoded when needed. Address only when there's no name. */
export function addressHeader(email: string, first: string | null, last: string | null): string {
  const address = email.replace(/[\r\n<>"]/g, "").trim();
  const name = [first, last].filter(Boolean).join(" ").replace(/[\r\n<>"]/g, "").trim();
  if (!name) return address;
  const display = /^[\x20-\x7e]*$/.test(name) ? (/[(),.:;@[\]\\]/.test(name) ? `"${name}"` : name) : encodeHeader(name);
  return `${display} <${address}>`;
}

const base64Lines = (s: string) => (Buffer.from(s, "utf8").toString("base64").match(/.{1,76}/g) ?? [""]).join(CRLF);

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text to simple HTML: a paragraph per blank-line block, <br> within one, links made clickable. */
export function textToHtml(text: string): string {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 1em 0">${escapeHtml(p).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>")}</p>`);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${paragraphs.join("")}</body></html>`;
}

/** One draft as an .eml file. `boundary` is fixed in tests; random otherwise. */
export function buildEml(d: OutlookDraft, boundary = `fl_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`): string {
  const text = d.text.replace(/\r\n/g, "\n").replace(/\n/g, CRLF);
  return [
    `To: ${addressHeader(d.to, d.firstName, d.lastName)}`,
    `Subject: ${encodeHeader(d.subject)}`,
    "X-Unsent: 1",
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(text),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(textToHtml(d.text)),
    `--${boundary}--`,
    "",
  ].join(CRLF);
}

/** Safe file-name part: letters, digits, dash; accents dropped to their base letter. */
const TRANSLIT: Record<string, string> = { æ: "ae", Æ: "ae", ø: "o", Ø: "o", ß: "ss", œ: "oe", Œ: "oe", đ: "d", Đ: "d", ł: "l", Ł: "l", þ: "th", Þ: "th" };

export function safePart(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/[æÆøØßœŒđĐłŁþÞ]/g, (c) => TRANSLIT[c])
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .toLowerCase();
}

/** "acme-studio_sanne.eml"; falls back to the email's local part; unique within the ZIP folder. */
export function emlFileName(d: OutlookDraft, used: Set<string>): string {
  const base = [safePart(d.company), safePart(d.firstName)].filter(Boolean).join("_") || safePart(d.to.split("@")[0]) || "lead";
  let name = `${base}.eml`;
  for (let i = 2; used.has(name); i++) name = `${base}_${i}.eml`;
  used.add(name);
  return name;
}

export const FOLDERS = {
  first: "step-1-first-email",
  followUp: (step: number) => `step-${step}-follow-up`,
};

export function readme(opts: { campaign: string; drafts: number; followUpSteps: number[]; mailMerge: boolean }): string {
  const steps = opts.followUpSteps.length ? opts.followUpSteps.map((s) => `step ${s}`).join(", ") : "";
  const en = [
    `FirstLine · ${opts.campaign} · ${opts.drafts} drafts`,
    "",
    "WHAT'S IN THIS ZIP",
    `- ${FOLDERS.first}/: one email per lead, ready to send from Outlook.`,
    ...(steps ? [`- Follow-ups (${steps}): one email per lead per step, in their own folders. These are NEW emails, not replies in the same thread. To keep the thread, open the first email in your Sent Items, click Reply, and paste the follow-up text instead.`] : []),
    ...(opts.mailMerge ? ["- mail-merge.csv and MAIL-MERGE.txt: for Word's mail merge (classic Outlook for Windows only)."] : []),
    "",
    "HOW TO OPEN THE DRAFTS",
    "Unzip this file first. Each .eml file is one email. Open one, check it, and click Send.",
    "- Classic Outlook for Windows: double-click the .eml file.",
    "- New Outlook for Windows: drag the .eml file onto the reading pane, or right-click it > Open with > Outlook (new).",
    "- Outlook on the web: drag the .eml file onto the reading pane.",
    "- Outlook for Mac: double-click the .eml file, or drag it onto Outlook.",
    "In most versions the email opens as a draft you can edit and send. If yours opens it read-only, choose Forward",
    "or copy the text into a new email, and check the recipient and subject.",
    "The email is sent from the account Outlook picks (usually your default account). Check the From field.",
    "",
    "SEND SLOWLY",
    "Send at most about 30 of these a day per inbox, spread over the day. New inboxes: start with 10 a day.",
    "Sending many cold emails at once is the quickest way to get your inbox blocked.",
    "Use a separate sending domain for outreach, not your main business domain.",
  ];
  const nl = [
    "",
    "----------------------------------------------------------------------",
    "",
    `FirstLine · ${opts.campaign} · ${opts.drafts} concepten`,
    "",
    "WAT ZIT ER IN DEZE ZIP",
    `- ${FOLDERS.first}/: één e-mail per lead, klaar om te versturen vanuit Outlook.`,
    ...(steps ? [`- Follow-ups (${steps.replace(/step/g, "stap")}): één e-mail per lead per stap, in eigen mappen. Dit zijn NIEUWE e-mails, geen antwoorden in dezelfde draad. Wil je de draad houden: open de eerste e-mail in Verzonden items, klik op Beantwoorden en plak daar de tekst van de follow-up.`] : []),
    ...(opts.mailMerge ? ["- mail-merge.csv en MAIL-MERGE.txt: voor samenvoegen in Word (alleen klassieke Outlook voor Windows)."] : []),
    "",
    "ZO OPEN JE DE CONCEPTEN",
    "Pak dit bestand eerst uit. Elk .eml-bestand is één e-mail. Open er een, controleer hem en klik op Verzenden.",
    "- Klassieke Outlook voor Windows: dubbelklik op het .eml-bestand.",
    "- Nieuwe Outlook voor Windows: sleep het .eml-bestand naar het leesvenster, of klik met rechts > Openen met > Outlook (new).",
    "- Outlook op het web: sleep het .eml-bestand naar het leesvenster.",
    "- Outlook voor Mac: dubbelklik op het .eml-bestand, of sleep het naar Outlook.",
    "In de meeste versies opent de e-mail als concept dat je kunt aanpassen en versturen. Opent jouw versie hem alleen",
    "om te lezen, kies dan Doorsturen of kopieer de tekst naar een nieuwe e-mail, en controleer ontvanger en onderwerp.",
    "De e-mail gaat uit vanaf het account dat Outlook kiest (meestal je standaardaccount). Controleer het Van-veld.",
    "",
    "VERSTUUR RUSTIG",
    "Verstuur er maximaal zo'n 30 per dag per inbox, verspreid over de dag. Nieuwe inbox: begin met 10 per dag.",
    "Veel cold e-mails tegelijk versturen is de snelste manier om je inbox te laten blokkeren.",
    "Gebruik een apart domein voor outreach, niet je hoofddomein.",
  ];
  return [...en, ...nl, ""].join(CRLF);
}

export const MAIL_MERGE_HELP = [
  "MAIL MERGE (classic Outlook for Windows only)",
  "Microsoft supports Word's email merge with classic Outlook for Windows. New Outlook only partly supports it,",
  "and it isn't possible in Outlook on the web or Word on the web. Word for Mac may work through your default mail app.",
  "",
  "1. Open Word > Mailings > Start Mail Merge > E-mail Messages.",
  "2. Select Recipients > Use an Existing List > choose mail-merge.csv.",
  "3. Insert Merge Field > full_email (the whole personalised email is in that one field).",
  "4. Finish & Merge > Send E-mail Messages. To: email. Subject line: type it, or leave it; Word uses one subject",
  "   for every email, so the per-lead subject from the CSV can't be used here. Mail format: Plain text.",
  "5. Word sends everything at once through Outlook. Send small batches (max ~30 a day per inbox), e.g. by",
  "   filtering the recipient list in step 2.",
  "",
  "SAMENVOEGEN (alleen klassieke Outlook voor Windows)",
  "1. Word > Verzendlijsten > Afdruk samenvoegen starten > E-mailberichten.",
  "2. Adressen selecteren > Een bestaande lijst gebruiken > kies mail-merge.csv.",
  "3. Samenvoegveld invoegen > full_email.",
  "4. Voltooien en samenvoegen > E-mailberichten verzenden. Aan: email. Onderwerp: één onderwerp voor iedereen.",
  "   Indeling: Platte tekst. Verstuur kleine groepen (max. ~30 per dag per inbox).",
  "",
].join(CRLF);

/** The mail-merge CSV: one row per first email. UTF-8 with BOM so Excel and Word read accents correctly. */
export function mailMergeCsv(leads: OutlookLead[]): string {
  const rows = leads.map((l) => ({
    email: l.first.to,
    subject: l.first.subject,
    full_email: l.first.text,
    first_name: l.first.firstName ?? "",
    company: l.first.company ?? "",
  }));
  return "﻿" + Papa.unparse({ fields: ["email", "subject", "full_email", "first_name", "company"], data: rows.map((r) => [r.email, r.subject, r.full_email, r.first_name, r.company]) });
}

/** The whole ZIP. `boundary` makes the output deterministic in tests. */
export function buildOutlookZip(input: { campaign: string; leads: OutlookLead[]; mailMerge: boolean; boundary?: (i: number) => string }): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const usedFirst = new Set<string>();
  const usedFollow = new Map<number, Set<string>>();
  let i = 0;
  const steps = new Set<number>();
  for (const l of input.leads) {
    files[`${FOLDERS.first}/${emlFileName(l.first, usedFirst)}`] = strToU8(buildEml(l.first, input.boundary?.(i++)));
    for (const f of l.followUps) {
      steps.add(f.step);
      const used = usedFollow.get(f.step) ?? new Set<string>();
      usedFollow.set(f.step, used);
      files[`${FOLDERS.followUp(f.step)}/${emlFileName(f.draft, used)}`] = strToU8(buildEml(f.draft, input.boundary?.(i++)));
    }
  }
  if (input.mailMerge) {
    files["mail-merge.csv"] = strToU8(mailMergeCsv(input.leads));
    files["MAIL-MERGE.txt"] = strToU8(MAIL_MERGE_HELP);
  }
  files["README.txt"] = strToU8(readme({ campaign: input.campaign, drafts: input.leads.length, followUpSteps: [...steps].sort((a, b) => a - b), mailMerge: input.mailMerge }));
  return zipSync(files, { level: 6 });
}

export function outlookZipName(campaign: string): string {
  return `${safePart(campaign) || "campaign"}-outlook-drafts.zip`;
}
