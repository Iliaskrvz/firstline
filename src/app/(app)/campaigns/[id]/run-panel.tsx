"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { runCampaign, stopCampaignRun } from "../actions";

/** Run the whole campaign. The fallback choice is made here, before anything is written. */
export function RunPanel({
  campaignId,
  total,
  remaining,
  sendFallbacks,
  running,
  disabledReason,
  creditsNeeded,
  available,
}: {
  campaignId: string;
  total: number;
  remaining: number;
  sendFallbacks: boolean;
  running: boolean;
  disabledReason: string | null;
  /** Upper bound this run reserves (leads with a website × credits per lead). */
  creditsNeeded: number;
  available: number;
}) {
  const [fallbacks, setFallbacks] = useState(sendFallbacks);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-slate-700">Run campaign</div>
      <fieldset className="space-y-1.5 text-sm" disabled={running || pending}>
        <legend className="mb-1 text-xs text-slate-500">If research finds nothing usable for a lead:</legend>
        <label className="flex items-start gap-2">
          <input type="radio" className="mt-0.5 accent-indigo-600" checked={fallbacks} onChange={() => setFallbacks(true)} />
          <span>
            Send the neutral version <span className="text-slate-500">(your copy, one neutral line, free)</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" className="mt-0.5 accent-indigo-600" checked={!fallbacks} onChange={() => setFallbacks(false)} />
          <span>Skip that lead</span>
        </label>
      </fieldset>
      <Button
        className="w-full"
        disabled={pending || running || remaining === 0 || !!disabledReason}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await runCampaign(campaignId, fallbacks);
            if (res?.error) setError(res.error);
          })
        }
      >
        {running ? "Running…" : pending ? "Starting…" : remaining === 0 ? "All leads are written" : remaining === total ? `Run all ${total} leads` : `Run the other ${remaining} leads`}
      </Button>
      {running && (
        <Button
          variant="ghost"
          className="w-full"
          disabled={pending}
          onClick={() => {
            if (!confirm("Stop this run? Leads not started yet are skipped and their reserved credits come back.")) return;
            start(async () => {
              const res = await stopCampaignRun(campaignId);
              if ("error" in res) setError(res.error);
            });
          }}
        >
          Stop run
        </Button>
      )}
      {(error || disabledReason) && <p className="text-center text-xs text-rose-700">{error ?? disabledReason}</p>}
      {!error && !disabledReason && remaining > 0 && (
        <p className={creditsNeeded > available ? "text-center text-xs text-rose-700" : "text-center text-xs text-slate-500"}>
          Reserves up to {creditsNeeded} credits · you have {available}.{" "}
          {creditsNeeded > available ? (
            <Link href="/credits" className="font-medium underline">
              Buy credits
            </Link>
          ) : (
            "Fallbacks are free; unused credits come back."
          )}
        </p>
      )}
    </div>
  );
}
