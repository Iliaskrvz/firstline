"use client";

import { useState, useTransition } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { createStarterTestSet, createTestSet, startEvalRun } from "./actions";

export function RunForm({ sets, versions, live }: { sets: { id: string; name: string }[]; versions: string[]; live: string }) {
  const [setId, setSetId] = useState(sets[0]?.id ?? "");
  const [candidate, setCandidate] = useState(versions[versions.length - 1] ?? live);
  const [baseline, setBaseline] = useState(live);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const select = (v: string, set: (x: string) => void, opts: string[]) => (
    <select className={inputClass} value={v} onChange={(e) => set(e.target.value)}>
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
          {o === live ? " (live)" : ""}
        </option>
      ))}
    </select>
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Test set">
          <select className={inputClass} value={setId} onChange={(e) => setSetId(e.target.value)}>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Candidate">{select(candidate, setCandidate, versions)}</Field>
        <Field label="Against (baseline)">{select(baseline, setBaseline, versions)}</Field>
      </div>
      <Button
        disabled={pending || !setId}
        onClick={() =>
          start(async () => {
            const r = await startEvalRun({ testSetId: setId, candidate, baseline });
            setMsg(r?.error ?? "Queued: the worker starts it within a minute.");
          })
        }
      >
        {pending ? "Queuing…" : "Run comparison"}
      </Button>
      {candidate === baseline && <p className="text-xs text-slate-500">Same version on both sides: a useful check of how noisy the judge is.</p>}
      {msg && <p className="text-xs text-slate-600">{msg}</p>}
    </div>
  );
}

export function NewTestSet({ hasStarter }: { hasStarter: boolean }) {
  const [name, setName] = useState("");
  const [csv, setCsv] = useState("");
  const [subject, setSubject] = useState("{{first_name}}, quick question about {{company}}");
  const [body, setBody] = useState("Hi {{first_name}},\n\n[[opener | one sentence about something specific and recent on their website | 25]]\n\nBest regards");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {!hasStarter && (
        <Button variant="secondary" disabled={pending} onClick={() => start(async () => void (await createStarterTestSet()))}>
          Add the starter test set (17 Dutch companies)
        </Button>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-medium text-slate-700">New test set from a CSV (up to 100 companies)</summary>
        <div className="mt-3 space-y-3">
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Accountants NL" />
          </Field>
          <Field label="CSV" hint="Columns like first_name, company, title, website. No email addresses needed.">
            <input
              type="file"
              accept=".csv,text/csv"
              className="text-sm"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setCsv(await f.text());
              }}
            />
          </Field>
          <Field label="Subject">
            <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Body (with at least one [[slot]])">
            <textarea rows={6} className={`${inputClass} font-mono text-xs`} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await createTestSet({ name, csv, subject, body });
                setMsg("error" in r ? r.error : `Saved with ${r.leads} companies.`);
              })
            }
          >
            {pending ? "Saving…" : "Save test set"}
          </Button>
          {msg && <p className="text-xs text-slate-600">{msg}</p>}
        </div>
      </details>
    </div>
  );
}
