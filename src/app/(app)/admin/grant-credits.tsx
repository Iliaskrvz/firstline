"use client";

import { useState, useTransition } from "react";
import { grantCredits } from "./actions";

/** Admin only: free credits for one workspace (a "bonus", never counted as bought or as revenue). */
export function GrantCredits({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [credits, setCredits] = useState("500");
  const [reason, setReason] = useState("Own outreach test");
  const [requestId, setRequestId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          className="text-xs font-medium text-brand-700 hover:underline"
          onClick={() => {
            setRequestId(crypto.randomUUID()); // one grant per opened form, even if Grant is clicked twice
            setMsg(null);
            setOpen(true);
          }}
        >
          Grant credits
        </button>
        {msg && <span className="text-xs text-emerald-700">{msg}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <input
        aria-label="Credits to grant"
        inputMode="numeric"
        className="w-16 rounded-md px-1.5 py-0.5 ring-1 ring-slate-300"
        value={credits}
        onChange={(e) => setCredits(e.target.value.replace(/\D/g, ""))}
        disabled={pending}
      />
      <input aria-label="What the grant is for" className="w-40 rounded-md px-1.5 py-0.5 ring-1 ring-slate-300" value={reason} onChange={(e) => setReason(e.target.value)} disabled={pending} />
      <button
        type="button"
        className="rounded-md bg-slate-900 px-2 py-0.5 font-medium text-white disabled:bg-slate-300"
        disabled={pending || !credits}
        onClick={() =>
          start(async () => {
            const r = await grantCredits({ workspaceId, credits: Number(credits), reason, requestId });
            if ("error" in r) setMsg(r.error);
            else {
              // A double click sends twice; the second answer must not hide that the first one granted.
              setMsg((prev) => (r.added ? `Granted ${credits} credits.` : prev?.startsWith("Granted") ? prev : "Already granted."));
              setOpen(false);
            }
          })
        }
      >
        {pending ? "…" : "Grant"}
      </button>
      <button type="button" className="text-slate-500 hover:underline" onClick={() => setOpen(false)} disabled={pending}>
        Cancel
      </button>
      {msg && <span className="text-slate-700">{msg}</span>}
    </span>
  );
}
