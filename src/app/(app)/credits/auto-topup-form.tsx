"use client";

import { useState, useTransition } from "react";
import { Button, inputClass } from "@/components/ui";
import { saveAutoTopUp } from "./actions";

export function AutoTopUpForm({
  initial,
  hasPaymentMethod,
  packs,
}: {
  initial: { enabled: boolean; threshold: number; pack: string };
  hasPaymentMethod: boolean;
  packs: { id: string; label: string }[];
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [threshold, setThreshold] = useState(initial.threshold);
  const [pack, setPack] = useState(initial.pack);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);

  return (
    <div className="space-y-3 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" className="accent-indigo-600" checked={enabled} disabled={!hasPaymentMethod && !enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Top up automatically
      </label>
      <div className="flex flex-wrap items-center gap-2 text-slate-700">
        When fewer than
        <input type="number" min={1} className={`${inputClass} w-24`} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        credits are left, buy
        <select className={`${inputClass} w-auto`} value={pack} onChange={(e) => setPack(e.target.value)}>
          {packs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      {!hasPaymentMethod && <p className="text-xs text-slate-500">Buy a pack once first: that saves the card or bank account used for top-ups.</p>}
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await saveAutoTopUp({ enabled, threshold, pack });
            setMsg("error" in res ? { error: res.error } : { ok: "Saved." });
          })
        }
      >
        {pending ? "Saving…" : "Save"}
      </Button>
      {msg && <p className={msg.error ? "text-xs text-rose-700" : "text-xs text-emerald-700"}>{msg.error ?? msg.ok}</p>}
    </div>
  );
}
