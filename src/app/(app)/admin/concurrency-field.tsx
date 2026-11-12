"use client";

import { useState, useTransition } from "react";
import { setConcurrency } from "./actions";

/** Leads at once for a workspace: empty = automatic (from credits bought). Saves on blur. */
export function ConcurrencyField({ workspaceId, value, automatic, max }: { workspaceId: string; value: number | null; automatic: number; max: number }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-1" title={`Leads in progress at once. Empty = automatic (${automatic}). Hard maximum ${max}.`}>
      <span>at once</span>
      <input
        className="w-14 rounded border border-slate-200 px-1.5 py-0.5 text-right"
        inputMode="numeric"
        placeholder={String(automatic)}
        value={v}
        disabled={pending}
        onChange={(e) => setV(e.target.value.replace(/\D/g, ""))}
        onBlur={() =>
          start(async () => {
            const limit = v === "" ? null : Number(v);
            if (limit === value) return;
            const r = await setConcurrency(workspaceId, limit);
            setError(r?.error ?? null);
          })
        }
      />
      {error && <span className="text-rose-700">{error}</span>}
    </label>
  );
}
