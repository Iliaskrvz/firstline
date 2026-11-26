"use client";

import { useState, useTransition } from "react";
import { buttonClass, inputClass } from "@/components/ui";
import { STRICTNESS_LABEL, TARGET_EXAMPLES, TARGET_MAX_CHARS, type Strictness, type TargetCustomer } from "@/lib/target-customer";
import { updateTargetCustomer, writeLeadAnyway } from "../actions";

/**
 * "Target customer": before writing, a fast AI model checks each company against this text. Not a fit
 * = no email, no credits. Empty = off.
 */
export function TargetCustomerSetting({ campaignId, target, locked }: { campaignId: string; target: TargetCustomer | null; locked: boolean }) {
  const [fits, setFits] = useState(target?.fits ?? "");
  const [excludes, setExcludes] = useState(target?.excludes ?? "");
  const [strictness, setStrictness] = useState<Strictness>(target?.strictness ?? "normal");
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const on = !!(fits.trim() || excludes.trim());

  function save(next?: { fits: string; excludes: string; strictness: Strictness }) {
    const v = next ?? { fits, excludes, strictness };
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const r = await updateTargetCustomer(campaignId, v);
      if ("error" in r) setError(r.error);
      else setSaved(v.fits.trim() || v.excludes.trim() ? "Saved. New leads are checked against this." : "Saved. The fit check is off.");
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-slate-700">Target customer</div>
        <span className={on ? "text-xs font-medium text-brand-700" : "text-xs text-slate-500"}>{on ? "Fit check on" : "Off"}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Before writing, AI checks each company&apos;s website against this. Not a fit = no email and no credits. Leave empty to write to everyone.
      </p>
      <label className="mt-3 block text-xs font-medium text-slate-700" htmlFor="tc-fits">
        Who fits
      </label>
      <textarea
        id="tc-fits"
        className={`${inputClass} mt-1 min-h-16`}
        maxLength={TARGET_MAX_CHARS}
        value={fits}
        disabled={pending || locked}
        placeholder="e.g. Independent bakeries with their own shop in the Netherlands"
        onChange={(e) => setFits(e.target.value)}
      />
      <label className="mt-2 block text-xs font-medium text-slate-700" htmlFor="tc-excludes">
        Who doesn&apos;t fit
      </label>
      <textarea
        id="tc-excludes"
        className={`${inputClass} mt-1 min-h-12`}
        maxLength={TARGET_MAX_CHARS}
        value={excludes}
        disabled={pending || locked}
        placeholder="e.g. franchises, wholesalers, webshops only"
        onChange={(e) => setExcludes(e.target.value)}
      />
      <fieldset className="mt-2" disabled={pending || locked}>
        <legend className="text-xs font-medium text-slate-700">When AI is unsure</legend>
        <div className="mt-1 space-y-1">
          {(Object.keys(STRICTNESS_LABEL) as Strictness[]).map((k) => (
            <label key={k} className="flex items-start gap-2 text-xs text-slate-700">
              <input type="radio" name="tc-strictness" className="mt-0.5 accent-brand-600" checked={strictness === k} onChange={() => setStrictness(k)} />
              <span>
                <span className="font-medium">{STRICTNESS_LABEL[k].label}:</span> {STRICTNESS_LABEL[k].hint}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {!locked && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-brand-700">Examples</summary>
          <ul className="mt-1 space-y-1">
            {TARGET_EXAMPLES.map((ex) => (
              <li key={ex.name}>
                <button
                  type="button"
                  className="text-left text-xs text-slate-600 hover:text-slate-900 hover:underline"
                  onClick={() => {
                    setFits(ex.fits);
                    setExcludes(ex.excludes);
                  }}
                >
                  {ex.name}: <span className="text-slate-500">{ex.fits}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button type="button" className={buttonClass("secondary", "py-1.5 text-xs")} disabled={pending || locked} onClick={() => save()}>
          {pending ? "Saving…" : "Save"}
        </button>
        {on && !locked && (
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-slate-800 hover:underline"
            disabled={pending}
            onClick={() => {
              setFits("");
              setExcludes("");
              save({ fits: "", excludes: "", strictness });
            }}
          >
            Turn off
          </button>
        )}
      </div>
      {locked && <p className="mt-1 text-xs text-slate-500">Can&apos;t change while the campaign is running.</p>}
      {saved && <p className="mt-1 text-xs text-emerald-700">{saved}</p>}
      {error && <p className="mt-1 text-xs text-rose-700">{error}</p>}
    </div>
  );
}

/** Per lead: write it even though the fit check skipped it. */
export function WriteAnywayButton({ campaignId, leadId, costsCredits }: { campaignId: string; leadId: string; costsCredits: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        className="text-xs font-medium text-brand-700 hover:underline disabled:text-slate-400"
        onClick={() =>
          start(async () => {
            const r = await writeLeadAnyway(campaignId, leadId);
            setError("error" in r ? r.error : null);
          })
        }
      >
        {pending ? "Queuing…" : costsCredits ? "Write anyway (1 credit)" : "Write anyway"}
      </button>
      {error && <span className="block text-xs text-rose-700">{error}</span>}
    </>
  );
}
