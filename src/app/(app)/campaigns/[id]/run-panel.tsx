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
  mode,
  waitingForBatch,
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
  mode: "now" | "economy";
  /** Leads whose writing waits for the Economy batch. */
  waitingForBatch: number;
}) {
  const [fallbacks, setFallbacks] = useState(sendFallbacks);
  const [speed, setSpeed] = useState<"now" | "economy">(mode);
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
      <fieldset className="space-y-1.5 text-sm" disabled={running || pending}>
        <legend className="mb-1 text-xs text-slate-500">Speed:</legend>
        <label className="flex items-start gap-2">
          <input type="radio" className="mt-0.5 accent-indigo-600" checked={speed === "now"} onChange={() => setSpeed("now")} />
          <span>
            Now <span className="text-slate-500">(ready in minutes)</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" className="mt-0.5 accent-indigo-600" checked={speed === "economy"} onChange={() => setSpeed("economy")} />
          <span>
            Economy <span className="text-slate-500">(written in one batch: usually within the hour, at most a day)</span>
          </span>
        </label>
      </fieldset>
      {running && waitingForBatch > 0 && (
        <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
          {waitingForBatch} {waitingForBatch === 1 ? "lead is" : "leads are"} researched and waiting for the Economy batch. You can close this page; they finish on their own.
        </p>
      )}
      <Button
        className="w-full"
        disabled={pending || running || remaining === 0 || !!disabledReason}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await runCampaign(campaignId, fallbacks, speed);
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
