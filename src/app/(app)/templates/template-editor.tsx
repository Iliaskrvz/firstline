"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Badge, Button, Card, Field, inputClass } from "@/components/ui";
import { TokenPreview } from "@/components/template-preview";
import { hasErrors, parseTemplate } from "@/lib/template";
import type { StyleRules, TemplateRow } from "@/lib/types";
import { saveTemplate } from "./actions";

const STARTER_BODY = `Hi {{first_name}},

[[opener · a specific observation about their company, from their website · 25]]

We help companies like {{company}} [your offer in one line]. [[bridge · one sentence linking their situation to our offer]]

Worth a quick look?

[Your name]`;

const DEMO_SAMPLE: Record<string, string> = {
  first_name: "Anna",
  last_name: "de Vries",
  company: "Acme Studio",
  email: "anna@acmestudio.nl",
  domain: "acmestudio.nl",
  website: "acmestudio.nl",
  title: "Founder",
};

const LANGS: { value: NonNullable<StyleRules["language"]>; label: string }[] = [
  { value: "auto", label: "Same as my copy" },
  { value: "en", label: "English" },
  { value: "nl", label: "Dutch" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
];

const toLines = (s: string) =>
  s
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export function TemplateEditor({
  template,
  campaignId,
  campaignName,
  variables,
  sample,
}: {
  template: TemplateRow | null;
  campaignId: string | null;
  campaignName: string | null;
  variables: string[] | null;
  sample: Record<string, string | null> | null;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "Quick idea for {{company}}");
  const [body, setBody] = useState(template?.body ?? STARTER_BODY);
  const rules = template?.style_rules ?? {};
  const [language, setLanguage] = useState<NonNullable<StyleRules["language"]>>(rules.language ?? "auto");
  const [tone, setTone] = useState(rules.tone ?? "");
  const [banned, setBanned] = useState((rules.banned_phrases ?? []).join("\n"));
  const [extra, setExtra] = useState((rules.extra_rules ?? []).join("\n"));
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const parsed = useMemo(
    () => parseTemplate({ subject, body }, { availableVariables: variables ?? undefined }),
    [subject, body, variables],
  );
  const previewVars = sample ?? DEMO_SAMPLE;

  function insert(snippet: string) {
    const el = bodyRef.current;
    if (!el) return setBody(body + snippet);
    const { selectionStart: a, selectionEnd: b } = el;
    const next = body.slice(0, a) + snippet + body.slice(b);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + snippet.length, a + snippet.length);
    });
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const res = await saveTemplate({
        id: template?.id ?? null,
        campaignId,
        name,
        subject,
        body,
        style_rules: { language, tone, banned_phrases: toLines(banned), extra_rules: toLines(extra) },
      });
      if (res && "error" in res) setMessage({ kind: "error", text: res.error });
      else if (res && "ok" in res) setMessage({ kind: "ok", text: "Saved." });
    });
  }

  const quickVars = (variables ?? ["first_name", "company"]).filter((v) => v !== "email").slice(0, 6);
  const errors = parsed.issues.filter((i) => i.level === "error");
  const warnings = parsed.issues.filter((i) => i.level === "warning");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Card className="space-y-4">
          <Field label="Template name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Agencies NL, v1" maxLength={120} />
          </Field>
          <Field label="Subject">
            <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
          </Field>
          <div>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <span className="text-sm font-medium text-slate-700">Body</span>
              <div className="flex flex-wrap gap-1">
                {quickVars.map((v) => (
                  <button key={v} type="button" onClick={() => insert(`{{${v}}}`)} className="tok-var text-xs hover:opacity-80">
                    {`{{${v}}}`}
                  </button>
                ))}
                <button type="button" onClick={() => insert("[[opener · what it should say · 25]]")} className="tok-slot text-xs hover:opacity-80">
                  + slot
                </button>
              </div>
            </div>
            <textarea
              ref={bodyRef}
              className={`${inputClass} mt-1.5 min-h-80 font-mono text-[13px] leading-relaxed`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              spellCheck
            />
          </div>
          <details className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">How the syntax works</summary>
            <ul className="mt-2 space-y-1.5">
              <li>
                <code className="tok-var">{"{{first_name}}"}</code> is a plain mail-merge field from your CSV.
              </li>
              <li>
                <code className="tok-slot">[[opener · instruction · 25]]</code> is written by FirstLine for each lead: <em>name · what to write · max words</em>. You can use <code>|</code> instead of <code>·</code>.
              </li>
              <li>Everything else is your copy and is sent word for word.</li>
              <li>Every claim in a slot must come from facts found on the lead&apos;s website. If nothing usable is found, the lead gets a neutral line and costs 0 credits.</li>
            </ul>
          </details>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Style rules</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Language">
              <select className={inputClass} value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
                {LANGS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tone">
              <input className={inputClass} value={tone} onChange={(e) => setTone(e.target.value)} placeholder="e.g. casual peer, use 'je' not 'u'" maxLength={200} />
            </Field>
          </div>
          <Field label="Banned phrases" hint="One per line. Added on top of FirstLine's built-in list.">
            <textarea className={`${inputClass} min-h-20`} value={banned} onChange={(e) => setBanned(e.target.value)} placeholder={"game-changer\nsynergy"} />
          </Field>
          <Field label="Extra rules" hint="One per line.">
            <textarea className={`${inputClass} min-h-20`} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={"Never mention competitors\nNo emoji"} />
          </Field>
        </Card>
      </div>

      <div className="space-y-6 lg:sticky lg:top-20 lg:self-start">
        <Card>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">Preview</h2>
            <span className="truncate text-xs text-slate-500">
              {sample ? `Sample lead from ${campaignName}` : "Demo lead (upload leads to use real data)"}
            </span>
          </div>
          <div className="mt-4 rounded-xl ring-1 ring-slate-200">
            <div className="border-b border-slate-100 px-4 py-3 text-sm">
              <span className="text-slate-500">Subject: </span>
              <span className="font-medium text-slate-900">
                <TokenPreview tokens={parsed.subject} vars={previewVars} />
              </span>
            </div>
            <div className="whitespace-pre-wrap px-4 py-4 text-sm leading-relaxed text-slate-800">
              <TokenPreview tokens={parsed.body} vars={previewVars} />
            </div>
          </div>

          <h3 className="mt-6 text-sm font-semibold text-slate-900">Slots FirstLine will write</h3>
          {parsed.slots.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">None yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {parsed.slots.map((s) => (
                <li key={s.key} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <Badge tone="indigo">✦ {s.key}</Badge>
                    <p className="mt-1 text-slate-600">{s.instruction || <em className="text-slate-400">no instruction</em>}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">{s.max_words ? `≤ ${s.max_words} words` : "1 sentence"}</span>
                </li>
              ))}
            </ul>
          )}

          {(errors.length > 0 || warnings.length > 0) && (
            <ul className="mt-4 space-y-1.5">
              {errors.map((i) => (
                <li key={i.message} className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {i.message}
                </li>
              ))}
              {warnings.map((i) => (
                <li key={i.message} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {i.message}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex items-center gap-3">
            <Button onClick={save} disabled={pending || hasErrors(parsed) || !name.trim()}>
              {pending ? "Saving…" : campaignId ? "Save and use in campaign" : "Save template"}
            </Button>
            {message && <span className={message.kind === "error" ? "text-sm text-rose-700" : "text-sm text-emerald-700"}>{message.text}</span>}
          </div>
        </Card>
      </div>
    </div>
  );
}
