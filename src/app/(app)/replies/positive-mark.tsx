"use client";

import { useState, useTransition } from "react";
import { markReplyPositive } from "./actions";

/** Positive / not positive, set by you after reading the reply in your own inbox. */
export function PositiveMark({ sendId, value }: { sendId: string; value: boolean | null }) {
  const [v, setV] = useState(value);
  const [pending, start] = useTransition();
  const set = (next: boolean | null) =>
    start(async () => {
      const r = await markReplyPositive(sendId, next);
      if (!r?.error) setV(next);
    });
  const btn = (active: boolean) => `rounded-md px-2 py-0.5 text-xs font-medium ring-1 ${active ? "bg-slate-900 text-white ring-slate-900" : "text-slate-600 ring-slate-200 hover:bg-slate-50"}`;
  return (
    <span className="inline-flex items-center gap-1" aria-label="Was this reply positive?">
      <button type="button" disabled={pending} className={btn(v === true)} aria-pressed={v === true} onClick={() => set(v === true ? null : true)}>
        Positive
      </button>
      <button type="button" disabled={pending} className={btn(v === false)} aria-pressed={v === false} onClick={() => set(v === false ? null : false)}>
        Not positive
      </button>
    </span>
  );
}
