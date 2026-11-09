"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Badge, Button, Card, cx, Field, inputClass } from "@/components/ui";
import { TokenPreview } from "@/components/template-preview";
import {
  DEFAULT_MAX_WORDS,
  formatSlot,
  hasErrors,
  MAX_MAX_WORDS,
  MIN_MAX_WORDS,
  parseTemplate,
  suggestSlotName,
  validateSlotDraft,
  type SlotDraft,
  type TemplateIssue,
} from "@/lib/template";
import type { StyleRules, TemplateRow } from "@/lib/types";
import { saveTemplate } from "./actions";

const STARTER_BODY = `Hi {{first_name}},

[[opener · a specific observation about their company, from their website · 25]]

We help companies like {{company}} [your offer in one line]. [[bridge · one sentence linking their situation to our offer · 25]]

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

function IssueList({ issues }: { issues: TemplateIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1" aria-live="polite">
      {issues.map((i) => (
        <li
          key={i.message}
          className={cx(
            "rounded-md px-2.5 py-1.5 text-xs",
            i.level === "error" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800",
          )}
        >
          {i.message}
        </li>
      ))}
    </ul>
  );
}

function AddSlotForm({
  existing,
  onInsert,
  onCancel,
}: {
  existing: string[];
  onInsert: (text: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<SlotDraft>({ key: suggestSlotName(existing), instruction: "", max_words: DEFAULT_MAX_WORDS });
  const [touched, setTouched] = useState(false);
  const errors = validateSlotDraft(draft, existing);
  const ok = Object.keys(errors).length === 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (ok) onInsert(formatSlot(draft));
  }

  const err = (k: keyof SlotDraft) => touched && errors[k] && <span className="mt-1 block text-xs text-rose-700">{errors[k]}</span>;

  return (
    <form onSubmit={submit} className="mt-2 rounded-xl bg-indigo-50/60 p-3 ring-1 ring-indigo-100">
      <div className="grid gap-2 sm:grid-cols-[140px_1fr_90px]">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Name</span>
          <input className={cx(inputClass, "mt-1")} value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} />
          {err("key")}
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">What should it say?</span>
          <input
            autoFocus
            className={cx(inputClass, "mt-1")}
            value={draft.instruction}
            placeholder="e.g. something specific from their website"
            onChange={(e) => setDraft({ ...draft, instruction: e.target.value })}
          />
          {err("instruction")}
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Max words</span>
          <input
            type="number"
            min={MIN_MAX_WORDS}
            max={MAX_MAX_WORDS}
            className={cx(inputClass, "mt-1")}
            value={draft.max_words}
            onChange={(e) => setDraft({ ...draft, max_words: e.target.value })}
          />
          {err("max_words")}
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button type="submit" className="py-1.5">
          Insert slot
        </Button>
        <Button type="button" variant="ghost" className="py-1.5" onClick={onCancel}>
          Cancel
        </Button>
        <code className="ml-auto hidden truncate text-xs text-indigo-700 sm:block">{ok ? formatSlot(draft) : ""}</code>
      </div>
    </form>
  );
}

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
  const [addingSlot, setAddingSlot] = useState(false);
  const [pending, startTransition] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<{ a: number; b: number } | null>(null);

  const parsed = useMemo(
    () => parseTemplate({ subject, body }, { availableVariables: variables ?? undefined }),
    [subject, body, variables],
  );
  const previewVars = sample ?? DEMO_SAMPLE;
  const subjectIssues = parsed.issues.filter((i) => i.part === "subject");
  const bodyIssues = parsed.issues.filter((i) => i.part !== "subject");
  const errorCount = parsed.issues.filter((i) => i.level === "error").length;

  function rememberCaret() {
    const el = bodyRef.current;
    if (el) caret.current = { a: el.selectionStart, b: el.selectionEnd };
  }

  function insert(snippet: string) {
    const el = bodyRef.current;
    const { a, b } = caret.current ?? (el ? { a: el.selectionStart, b: el.selectionEnd } : { a: body.length, b: body.length });
    setBody(body.slice(0, a) + snippet + body.slice(b));
    caret.current = null;
    requestAnimationFrame(() => {
      if (!el) return;
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
  const saveBlocker = !name.trim() ? "Give the template a name." : errorCount ? `Fix ${errorCount} error${errorCount > 1 ? "s" : ""} to save.` : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Card className="space-y-4">
          <Field label="Template name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Agencies NL, v1" maxLength={120} />
          </Field>
          <div>
            <Field label="Subject">
              <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
            </Field>
            <IssueList issues={subjectIssues} />
          </div>
          <div>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <span className="text-sm font-medium text-slate-700">Body</span>
              <div className="flex flex-wrap items-center gap-1">
                {quickVars.map((v) => (
                  <button key={v} type="button" onMouseDown={rememberCaret} onClick={() => insert(`{{${v}}}`)} className="tok-var text-xs hover:opacity-80">
                    {`{{${v}}}`}
                  </button>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  className="ml-1 px-2.5 py-1 text-xs"
                  onMouseDown={rememberCaret}
                  onClick={() => setAddingSlot((v) => !v)}
                  aria-expanded={addingSlot}
                >
                  + Add slot
                </Button>
              </div>
            </div>
            {addingSlot && (
              <AddSlotForm
                existing={parsed.slots.map((s) => s.key)}
                onCancel={() => setAddingSlot(false)}
                onInsert={(text) => {
                  insert(text);
                  setAddingSlot(false);
                }}
              />
            )}
            <textarea
              ref={bodyRef}
              className={cx(inputClass, "mt-2 min-h-80 font-mono text-[13px] leading-relaxed", errorCount > 0 && "ring-rose-300")}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={rememberCaret}
              spellCheck
              aria-invalid={errorCount > 0}
            />
            <IssueList issues={bodyIssues} />
          </div>
          <details className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">How the syntax works</summary>
            <ul className="mt-2 space-y-1.5">
              <li>
                <code className="tok-var">{"{{first_name}}"}</code> is a plain mail-merge field from your CSV.
              </li>
              <li>
                <code className="tok-slot">[[opener · instruction · 25]]</code> is written by FirstLine for each lead: <em>name · what to write · max words</em>. Use <code>·</code> or <code>|</code>. Max words is optional (default {DEFAULT_MAX_WORDS}, {MIN_MAX_WORDS}–{MAX_MAX_WORDS}).
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
            <p className="mt-2 text-sm text-slate-500">None yet. Use “+ Add slot”.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {parsed.slots.map((s) => (
                <li key={s.key} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <Badge tone="indigo">✦ {s.key}</Badge>
                    <p className="mt-1 text-slate-600">{s.instruction || <em className="text-slate-400">no instruction</em>}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">≤ {s.max_words} words</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button onClick={save} disabled={pending || !!saveBlocker}>
              {pending ? "Saving…" : campaignId ? "Save and use in campaign" : "Save template"}
            </Button>
            {saveBlocker && <span className="text-sm text-slate-500">{saveBlocker}</span>}
            {message && <span className={message.kind === "error" ? "text-sm text-rose-700" : "text-sm text-emerald-700"}>{message.text}</span>}
          </div>
        </Card>
      </div>
    </div>
  );
}
