"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { startQualifyTest } from "./actions";

/** Upload the labelled CSV and approve the spend. Nothing runs without the tick. */
export function QualifyTestForm({ budgetUsd, provider, busy, firecrawlPerLead }: { budgetUsd: number; provider: "fake" | "anthropic" | "deepseek"; busy: boolean; firecrawlPerLead: number }) {
  const [csv, setCsv] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const rows = csv ? Math.max(0, csv.trim().split(/\r?\n/).length - 1) : 0;
  return (
    <div className="space-y-3 text-sm">
      <label className="block">
        <span className="font-medium text-slate-700">Labelled leads (CSV)</span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="mt-1 block text-sm"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setMsg(null);
            if (!f) return;
            setName(f.name);
            setCsv(await f.text());
          }}
        />
      </label>
      {name && (
        <p className="text-xs text-slate-600">
          {name}: about {rows} leads · about {rows * firecrawlPerLead} Firecrawl credits · hard budget ${budgetUsd} for the AI provider
        </p>
      )}
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} className="mt-0.5 size-4" />
        <span>
          I approve spending up to ${budgetUsd} on {provider === "deepseek" ? "DeepSeek" : provider === "anthropic" ? "Claude" : "nothing (fake provider: test output, no AI used)"} and the Firecrawl
          credits for this test.
        </span>
      </label>
      <Button
        disabled={pending || busy || !approved || !csv}
        onClick={() =>
          start(async () => {
            const r = await startQualifyTest({ csv, approved });
            setMsg("error" in r ? r.error : `Queued ${r.leads} leads: the worker starts within a minute.`);
          })
        }
      >
        {pending ? "Queuing…" : busy ? "A test is running" : "Start qualification test"}
      </Button>
      {msg && <p className="text-xs text-slate-600">{msg}</p>}
    </div>
  );
}
