"use client";

import { useState, useTransition } from "react";
import { Button, inputClass } from "@/components/ui";
import { saveSequence } from "../actions";

type Step = { delay_days: number; kind: "plain" | "personalised"; template_body: string };

const EXAMPLE: Record<Step["kind"], string> = {
  plain: "Hi {{first_name}}, just bumping this up. Worth a quick chat?",
  personalised: "Hi {{first_name}}, one more thought: [[angle · a different specific fact from their website than the first email · 25]]\n\nOpen to a short call?",
};

export function SequenceEditor({
  campaignId,
  initial,
  locked,
  hasRun,
  stats,
}: {
  campaignId: string;
  initial: Step[];
  locked: boolean;
  hasRun: boolean;
  /** Per step (1 = first email): sent, replied, bounced. */
  stats: Record<number, { sent: number; replied: number; bounced: number }>;
}) {
  const [steps, setSteps] = useState<Step[]>(initial);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ error?: string; ok?: string } | null>(null);
  const dirty = JSON.stringify(steps) !== JSON.stringify(initial);
  const update = (i: number, patch: Partial<Step>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Sequence</h2>
        <span className="text-xs text-slate-500">Follow-ups go out in the same thread and stop when the lead replies.</span>
      </div>

      <StepRow n={1} title="Email 1: your template" stat={stats[1]} />

      {steps.map((st, i) => (
        <div key={i} className="space-y-2 rounded-xl p-3 ring-1 ring-slate-200">
          <StepRow n={i + 2} title={`Follow-up ${i + 2}`} stat={stats[i + 2]} />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-600">After</span>
            <input
              type="number"
              min={0}
              max={30}
              disabled={locked}
              className={`${inputClass} w-20`}
              value={st.delay_days}
              onChange={(e) => update(i, { delay_days: Number(e.target.value) })}
            />
            <span className="text-slate-600">working days without a reply,</span>
            <select
              disabled={locked || (hasRun && st.kind === "personalised")}
              className={`${inputClass} w-auto`}
              value={st.kind}
              onChange={(e) => update(i, { kind: e.target.value as Step["kind"] })}
            >
              <option value="plain">plain (free)</option>
              <option value="personalised" disabled={hasRun}>
                personalised [[slots]]
              </option>
            </select>
            {!locked && !(hasRun && st.kind === "personalised") && (
              <button type="button" className="ml-auto text-xs text-rose-700 hover:underline" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
                Remove
              </button>
            )}
          </div>
          <textarea
            rows={4}
            disabled={locked || (hasRun && st.kind === "personalised")}
            className={`${inputClass} font-mono text-xs`}
            value={st.template_body}
            onChange={(e) => update(i, { template_body: e.target.value })}
          />
        </div>
      ))}

      {locked ? (
        <p className="text-xs text-slate-500">The sequence is locked because sending has started.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {steps.length < 4 && (
            <Button
              variant="secondary"
              onClick={() => setSteps([...steps, { delay_days: steps.length ? 3 : 2, kind: "plain", template_body: EXAMPLE.plain }])}
            >
              + Plain follow-up
            </Button>
          )}
          {steps.length < 4 && !hasRun && (
            <Button variant="secondary" onClick={() => setSteps([...steps, { delay_days: steps.length ? 3 : 2, kind: "personalised", template_body: EXAMPLE.personalised }])}>
              + Personalised follow-up
            </Button>
          )}
          <Button
            className="ml-auto"
            disabled={!dirty || pending}
            onClick={() =>
              start(async () => {
                const res = await saveSequence({ campaignId, steps });
                setMessage("error" in res ? { error: res.error } : { ok: "Saved." });
              })
            }
          >
            {pending ? "Saving…" : "Save sequence"}
          </Button>
        </div>
      )}
      {hasRun && !locked && <p className="text-xs text-slate-500">Personalised follow-ups are written during the run; after it you can still add plain ones.</p>}
      {message && <p className={message.error ? "text-sm text-rose-700" : "text-sm text-emerald-700"}>{message.error ?? message.ok}</p>}
    </div>
  );
}

function StepRow({ title, stat }: { n: number; title: string; stat?: { sent: number; replied: number; bounced: number } }) {
  const rate = stat && stat.sent ? Math.round((stat.replied / stat.sent) * 100) : null;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="font-medium text-slate-800">{title}</span>
      <span className="text-xs text-slate-500">
        {stat?.sent ?? 0} sent · {stat?.replied ?? 0} replied · {stat?.bounced ?? 0} bounced
        {rate != null && ` · ${rate}% reply rate`}
      </span>
    </div>
  );
}
