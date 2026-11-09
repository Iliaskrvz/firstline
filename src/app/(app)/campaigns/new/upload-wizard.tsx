"use client";

import { useMemo, useState, useTransition } from "react";
import { Badge, Button, Card, cx, Field, inputClass, Stat } from "@/components/ui";
import {
  applyMapping,
  autoMapColumns,
  FIELD_LABELS,
  mappingErrors,
  parseCsv,
  type ColumnMap,
  type ColumnTarget,
  type ParsedCsv,
} from "@/lib/csv";
import { estimateCredits } from "@/lib/credits";
import { n } from "@/lib/format";
import { importLeads } from "../actions";

const TARGET_OPTIONS: ColumnTarget[] = ["email", "first_name", "last_name", "full_name", "company", "title", "linkedin_headline", "website", "custom", "ignore"];
const MAX_BYTES = 8 * 1024 * 1024;

const ISSUE_LABEL = {
  missing_email: "No email",
  invalid_email: "Invalid email",
  duplicate: "Duplicate",
  no_website: "No website",
} as const;

export function UploadWizard() {
  const [file, setFile] = useState<{ name: string; csv: ParsedCsv } | null>(null);
  const [map, setMap] = useState<ColumnMap>({});
  const [name, setName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function load(f: File) {
    setError(null);
    if (!/\.(csv|txt|tsv)$/i.test(f.name)) return setError("Please upload a .csv file. In Excel or Google Sheets: File → Download → CSV.");
    if (f.size > MAX_BYTES) return setError("That file is larger than 8 MB. Split it into smaller lists.");
    const csv = parseCsv(await f.text());
    if (csv.headers.length === 0 || csv.rows.length === 0) return setError("We couldn't find any rows in that file.");
    setFile({ name: f.name, csv });
    setMap(autoMapColumns(csv.headers));
    setName(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
  }

  const result = useMemo(() => (file ? applyMapping(file.csv.rows, map) : null), [file, map]);
  const errors = useMemo(() => (file ? mappingErrors(map) : []), [file, map]);
  const withWebsite = result ? result.stats.imported - result.stats.no_website : 0;

  function submit() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const res = await importLeads({ name, rows: file.csv.rows, map });
      if (res?.error) setError(res.error);
    });
  }

  if (!file) {
    return (
      <Card>
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) void load(f);
          }}
          className={cx(
            "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors",
            dragging ? "border-indigo-400 bg-indigo-50" : "border-slate-300 hover:border-indigo-300 hover:bg-slate-50",
          )}
        >
          <svg className="size-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
          </svg>
          <span className="mt-4 text-sm font-medium text-slate-900">Drop your CSV here, or click to choose a file</span>
          <span className="mt-1 text-xs text-slate-500">Needs at least an email column. A website column lets FirstLine research each company.</span>
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f);
            }}
          />
        </label>
        {error && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      </Card>
    );
  }

  const samples = (h: string) =>
    file.csv.rows
      .map((r) => r[h])
      .filter(Boolean)
      .slice(0, 2);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Map your columns</h2>
              <p className="text-sm text-slate-500">
                {file.name} · {n(file.csv.rows.length)} rows · {file.csv.headers.length} columns
              </p>
            </div>
            <Button variant="ghost" onClick={() => setFile(null)}>
              Choose another file
            </Button>
          </div>
          {file.csv.errors.length > 0 && (
            <ul className="mt-4 space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              {file.csv.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className="mt-5 divide-y divide-slate-100">
            {file.csv.headers.map((h) => (
              <div key={h} className="grid grid-cols-1 items-center gap-2 py-3 sm:grid-cols-[1fr_220px]">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800">{h}</div>
                  <div className="truncate text-xs text-slate-500">{samples(h).join(" · ") || <em>empty</em>}</div>
                </div>
                <select
                  className={inputClass}
                  value={map[h]}
                  onChange={(e) => setMap({ ...map, [h]: e.target.value as ColumnTarget })}
                  aria-label={`Map column ${h}`}
                >
                  {TARGET_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {FIELD_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            <strong>Custom variable</strong> columns become <code className="tok-var">{"{{variables}}"}</code> you can use in
            your template. Name, title and headline are only used for relevance, never as a hook.
          </p>
        </Card>

        {result && result.issues.length > 0 && (
          <Card>
            <h2 className="text-base font-semibold text-slate-900">Rows that need attention</h2>
            <p className="text-sm text-slate-500">Leads without a website are imported, but they&apos;ll get the neutral fallback line (free).</p>
            <div className="mt-4 max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {result.issues.slice(0, 200).map((i) => (
                    <tr key={`${i.row}-${i.reason}`}>
                      <td className="w-16 py-2 text-slate-500 tabular-nums">Row {i.row}</td>
                      <td className="w-32 py-2">
                        <Badge tone={i.reason === "no_website" ? "amber" : "red"}>{ISSUE_LABEL[i.reason]}</Badge>
                      </td>
                      <td className="truncate py-2 text-slate-600">{i.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.issues.length > 200 && <p className="py-2 text-xs text-slate-500">…and {n(result.issues.length - 200)} more</p>}
            </div>
          </Card>
        )}
      </div>

      <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <Card className="space-y-4">
          <Field label="Campaign name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>
          {result && (
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Will import" value={n(result.stats.imported)} tone="green" />
              <Stat label="With website" value={n(withWebsite)} />
              <Stat label="Duplicates removed" value={n(result.stats.duplicates)} />
              <Stat label="Skipped (email)" value={n(result.stats.missing_email + result.stats.invalid_email)} />
            </div>
          )}
          <div className="rounded-xl bg-indigo-50 p-4">
            <div className="text-xs font-medium text-indigo-700">Estimated cost</div>
            <div className="mt-0.5 text-xl font-semibold text-indigo-900">≤ {n(estimateCredits(withWebsite, { deep: false, local: false }))} credits</div>
            <div className="mt-1 text-xs text-indigo-800/80">1 credit per personalised email. Fallbacks are free.</div>
          </div>
          {result && result.stats.imported > 0 && result.stats.personal_email / result.stats.imported > 0.3 && (
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              {n(result.stats.personal_email)} leads use personal addresses (Gmail, Hotmail…). Cold emailing private individuals
              is restricted in the EU. Make sure you have a lawful basis.
            </p>
          )}
          {errors.map((e) => (
            <p key={e} className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
              {e}
            </p>
          ))}
          {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          <Button className="w-full" onClick={submit} disabled={pending || errors.length > 0 || !result?.stats.imported || !name.trim()}>
            {pending ? "Importing…" : `Import ${n(result?.stats.imported)} leads`}
          </Button>
        </Card>
      </div>
    </div>
  );
}
