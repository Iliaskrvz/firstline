"use client";

import { useMemo, useState, useTransition } from "react";
import { Badge, Button, Card, cx, Field, inputClass, Stat } from "@/components/ui";
import {
  analyseColumns,
  applyMapping,
  decodeCsvBytes,
  FIELD_LABELS,
  groupIssues,
  importBlocker,
  parseCsv,
  uploadView,
  type ColumnMap,
  type ColumnTarget,
  type EmailSuggestion,
  type ParsedCsv,
} from "@/lib/csv";
import { estimateCredits } from "@/lib/credits";
import { n } from "@/lib/format";
import { importLeads } from "../actions";

const TARGET_OPTIONS: ColumnTarget[] = ["email", "first_name", "last_name", "full_name", "company", "title", "linkedin_headline", "website", "custom", "ignore"];
const MAX_BYTES = 8 * 1024 * 1024;
const SHOW_PER_GROUP = 100;

type Loaded = {
  name: string;
  csv: ParsedCsv;
  encoding: string;
  suggestion: EmailSuggestion | null;
  looksLikeLeadList: boolean;
};

function SuggestionBanner({ s, onAccept, onDismiss }: { s: EmailSuggestion; onAccept: () => void; onDismiss?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-indigo-50 p-4 text-sm text-indigo-900 ring-1 ring-indigo-100">
      <p className="min-w-0 flex-1">
        Column <strong>‘{s.header}’</strong> contains email addresses ({n(s.valid)} of {n(s.filled)} filled rows). Use it as Email?
      </p>
      <Button className="py-1.5" onClick={onAccept}>
        Use as Email
      </Button>
      {onDismiss && (
        <Button variant="ghost" className="py-1.5" onClick={onDismiss}>
          No
        </Button>
      )}
    </div>
  );
}

export function UploadWizard() {
  const [file, setFile] = useState<Loaded | null>(null);
  const [map, setMap] = useState<ColumnMap>({});
  const [pickManually, setPickManually] = useState(false);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [name, setName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setFile(null);
    setMap({});
    setPickManually(false);
    setSuggestionDismissed(false);
    setError(null);
  }

  async function load(f: File) {
    setError(null);
    if (!/\.(csv|txt|tsv)$/i.test(f.name)) return setError("Please upload a .csv file. In Excel or Google Sheets: File → Download → CSV.");
    if (f.size > MAX_BYTES) return setError("That file is larger than 8 MB. Split it into smaller lists.");
    const { text, encoding } = decodeCsvBytes(new Uint8Array(await f.arrayBuffer()));
    const csv = parseCsv(text);
    if (csv.headers.length === 0 || csv.rows.length === 0) return setError("We couldn't find any rows in that file.");
    const analysis = analyseColumns(csv.headers, csv.rows);
    setFile({ name: f.name, csv, encoding, suggestion: analysis.emailSuggestion, looksLikeLeadList: analysis.looksLikeLeadList });
    setMap(analysis.map);
    setPickManually(false);
    setSuggestionDismissed(false);
    setName(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
  }

  const result = useMemo(() => (file ? applyMapping(file.csv.rows, map, file.csv.rowNumbers) : null), [file, map]);
  const blocker = result ? importBlocker(map, result.stats) ?? (!name.trim() ? "Give the campaign a name." : null) : null;
  const withWebsite = result ? result.stats.imported - result.stats.no_website : 0;
  const hasEmailColumn = Object.values(map).includes("email");

  function acceptSuggestion(header: string) {
    setMap((m) => ({ ...m, [header]: "email" }));
    setPickManually(true);
  }

  function submit() {
    if (!file || blocker) return;
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
              e.target.value = "";
              if (f) void load(f);
            }}
          />
        </label>
        {error && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      </Card>
    );
  }

  if (uploadView(file, pickManually) === "wrong_file") {
    return (
      <Card className="mx-auto max-w-2xl py-10 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-amber-50 text-xl text-amber-600" aria-hidden>
          ?
        </div>
        <h2 className="mt-4 text-lg font-semibold text-slate-900">This doesn&apos;t look like a lead list</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
          We couldn&apos;t find an email or website column in <strong>{file.name}</strong> ({file.csv.headers.join(", ")}).
        </p>
        {file.suggestion && (
          <div className="mx-auto mt-6 max-w-lg text-left">
            <SuggestionBanner s={file.suggestion} onAccept={() => acceptSuggestion(file.suggestion!.header)} />
          </div>
        )}
        <div className="mt-6 flex items-center justify-center gap-4">
          <Button variant="secondary" onClick={reset}>
            Choose another file
          </Button>
          <button className="text-sm font-medium text-indigo-700 hover:underline" onClick={() => setPickManually(true)}>
            Pick columns manually
          </button>
        </div>
      </Card>
    );
  }

  const samples = (h: string) =>
    file.csv.rows
      .map((r) => r[h])
      .filter(Boolean)
      .slice(0, 2);

  const groups = result ? groupIssues(result.issues) : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        {file.suggestion && !hasEmailColumn && !suggestionDismissed && (
          <SuggestionBanner
            s={file.suggestion}
            onAccept={() => acceptSuggestion(file.suggestion!.header)}
            onDismiss={() => setSuggestionDismissed(true)}
          />
        )}
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Map your columns</h2>
              <p className="text-sm text-slate-500">
                {file.name} · {n(file.csv.rows.length)} rows · {file.csv.headers.length} columns
                {file.encoding === "windows-1252" && " · read as Excel (Windows-1252) text"}
              </p>
            </div>
            <Button variant="ghost" onClick={reset}>
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

        {groups.length > 0 && (
          <Card>
            <h2 className="text-base font-semibold text-slate-900">Rows that need attention</h2>
            <p className="text-sm text-slate-500">Row numbers match your spreadsheet (the header is row 1).</p>
            <div className="mt-4 space-y-5">
              {groups.map((g) => (
                <section key={g.reason}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={g.tone}>
                      {g.title} · {n(g.rows.length)}
                    </Badge>
                    <span className="text-sm text-slate-600">{g.intro}</span>
                  </div>
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-lg ring-1 ring-slate-100">
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-slate-100">
                        {g.rows.slice(0, SHOW_PER_GROUP).map((i) => (
                          <tr key={i.row}>
                            <td className="w-20 px-3 py-1.5 text-slate-500 tabular-nums">Row {i.row}</td>
                            <td className="truncate px-3 py-1.5 text-slate-600">{i.detail ?? <em className="text-slate-400">empty</em>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {g.rows.length > SHOW_PER_GROUP && <p className="mt-1 text-xs text-slate-500">…and {n(g.rows.length - SHOW_PER_GROUP)} more</p>}
                </section>
              ))}
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
              <Stat label="Skipped: no email" value={n(result.stats.missing_email + result.stats.invalid_email)} />
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
          {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
          <div className="space-y-2">
            <Button className="w-full" onClick={submit} disabled={pending || !!blocker} aria-describedby="import-blocker">
              {pending ? "Importing…" : blocker ? "Import leads" : `Import ${n(result?.stats.imported)} leads`}
            </Button>
            {blocker && (
              <p id="import-blocker" className="text-center text-sm text-rose-700">
                {blocker}
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
