"use client";

import { useState, useTransition } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { addInbox } from "./actions";
import { SetupSteps } from "./setup-steps";

const DAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
] as const;

export function AddInbox({ appUrl, script }: { appUrl: string | null; script: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [start, setStart] = useState("08:30");
  const [end, setEnd] = useState("17:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [cap, setCap] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ key: string; email: string; updated?: boolean } | null>(null);
  const [pending, start_] = useTransition();

  if (created) {
    return (
      <div className="space-y-3">
        {created.updated && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {created.email} was already added: its settings are updated and it has a new key. Paste the new key in the sheet (FirstLine → Connect…).
          </p>
        )}
        <SetupSteps email={created.email} senderKey={created.key} appUrl={appUrl} script={script} />
        <Button variant="secondary" onClick={() => (setCreated(null), setOpen(false), setEmail(""))}>
          Done
        </Button>
      </div>
    );
  }
  if (!open) return <Button onClick={() => setOpen(true)}>Add Gmail inbox</Button>;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Amsterdam";
        start_(async () => {
          const res = await addInbox({ email, tz, start, end, days, daily_cap: cap });
          if ("error" in res) setError(res.error);
          else setCreated(res);
        });
      }}
    >
      <Field label="Gmail address you'll send from" hint="Tip: a Google Workspace inbox on a separate domain keeps your main domain safe.">
        <input className={inputClass} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourcompany.com" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Send from">
          <input className={inputClass} type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Until">
          <input className={inputClass} type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="Max per day" hint="Starts at 10 and grows by 2 each sending day.">
          <input className={inputClass} type="number" min={1} max={100} value={cap} onChange={(e) => setCap(Number(e.target.value))} />
        </Field>
      </div>
      <Field label="Days" hint={`In your timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`}>
        <div className="flex flex-wrap gap-2">
          {DAYS.map(([d, label]) => (
            <label key={d} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm ring-1 ring-slate-200">
              <input
                type="checkbox"
                className="accent-brand-600"
                checked={days.includes(d)}
                onChange={(e) => setDays(e.target.checked ? [...days, d] : days.filter((x) => x !== d))}
              />
              {label}
            </label>
          ))}
        </div>
      </Field>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save inbox and create key"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
