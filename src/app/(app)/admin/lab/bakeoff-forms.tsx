"use client";

import { useState, useTransition } from "react";
import { Button, cx } from "@/components/ui";
import { pickBlind, startBakeoff } from "./actions";

type SetOption = { id: string; name: string; n: number };

export function BakeoffForm(props: {
  sets: SetOption[];
  maxLeads: number;
  creditsPerLead: number;
  budgetUsd: number;
  provider: "fake" | "anthropic" | "deepseek";
  writers: string[];
  busy: boolean;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [approved, setApproved] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const leads = Math.min(
    props.maxLeads,
    props.sets.filter((s) => chosen.includes(s.id)).reduce((a, s) => a + s.n, 0),
  );
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  return (
    <div className="space-y-4 text-sm">
      <fieldset className="space-y-2">
        <legend className="font-medium text-slate-700">Test sets (use one Dutch and one English set for a mix; up to {props.maxLeads} leads)</legend>
        {props.sets.map((s) => (
          <label key={s.id} className="flex items-center gap-2">
            <input type="checkbox" checked={chosen.includes(s.id)} onChange={() => toggle(s.id)} className="size-4" />
            {s.name} <span className="text-slate-500">({s.n} leads)</span>
          </label>
        ))}
      </fieldset>
      <div className="rounded-xl bg-slate-50 p-4 text-slate-700 ring-1 ring-slate-200">
        <p>
          <strong>{leads}</strong> leads · writers: {props.writers.join(", ")} · about <strong>{leads * props.creditsPerLead}</strong> Firecrawl credits ·
          hard budget <strong>${props.budgetUsd}</strong> for the AI provider
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {props.provider === "fake"
            ? "LLM_PROVIDER is fake on this server: test output, no AI used, $0 for Claude (Firecrawl still reads the websites)."
            : `Runs on the real ${props.provider === "deepseek" ? "DeepSeek" : "Claude"} API. After 5 leads it projects the whole run and stops if that would go over the budget.${props.provider === "deepseek" ? " The off-peak writer waits for DeepSeek's off-peak hours." : ""}`}
        </p>
      </div>
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} className="mt-0.5 size-4" />
        <span>
          I approve spending up to ${props.budgetUsd} on {props.provider === "deepseek" ? "DeepSeek" : "Claude"} and about {leads * props.creditsPerLead} Firecrawl credits for this bake-off.
        </span>
      </label>
      <Button
        disabled={pending || props.busy || !approved || leads === 0}
        onClick={() =>
          start(async () => {
            const r = await startBakeoff({ testSetIds: chosen, approved });
            setMsg(r?.error ?? "Queued: the worker starts it within a minute.");
          })
        }
      >
        {pending ? "Queuing…" : props.busy ? "A bake-off is running" : "Start bake-off"}
      </Button>
      {msg && <p className="text-xs text-slate-600">{msg}</p>}
    </div>
  );
}

export function BlindPick({ id, n, a, b, picked }: { id: number; n: number; a: string; b: string; picked: "a" | "b" | "same" | null }) {
  const [pick, setPick] = useState(picked);
  const [pending, start] = useTransition();
  const choose = (p: "a" | "b" | "same") =>
    start(async () => {
      setPick(p);
      await pickBlind({ id, n, pick: p });
    });
  const option = (key: "a" | "b", text: string) => (
    <button
      type="button"
      disabled={pending}
      onClick={() => choose(key)}
      className={cx(
        "rounded-xl p-4 text-left text-sm whitespace-pre-line ring-1 transition-colors",
        pick === key ? "bg-brand-50 ring-2 ring-brand-500" : "bg-white ring-slate-200 hover:bg-slate-50",
      )}
    >
      <span className="mb-2 block text-xs font-semibold text-slate-500 uppercase">Version {key.toUpperCase()}</span>
      {text}
    </button>
  );
  return (
    <div className="space-y-2">
      <div className="grid gap-3 md:grid-cols-2">
        {option("a", a)}
        {option("b", b)}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => choose("same")}
        className={cx("text-xs", pick === "same" ? "font-semibold text-brand-700" : "text-slate-500 hover:text-slate-800")}
      >
        {pick === "same" ? "✓ Equally good" : "Equally good"}
      </button>
    </div>
  );
}
