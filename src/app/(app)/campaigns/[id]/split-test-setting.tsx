"use client";

import { useState, useTransition } from "react";
import { buttonClass, inputClass } from "@/components/ui";
import { updateSplitTest } from "../actions";

/**
 * Admin only (owner's own outreach): a 50/50 split. Half the leads get the plain copy below, half get
 * FirstLine; same inboxes, same schedule. Only before the campaign runs.
 */
export function SplitTestSetting({
  campaignId,
  split,
  defaultPlain,
  locked,
}: {
  campaignId: string;
  split: { plain_subject: string; plain_body: string } | null;
  defaultPlain: { subject: string; body: string };
  locked: boolean;
}) {
  const [on, setOn] = useState(!!split);
  const [subject, setSubject] = useState(split?.plain_subject ?? defaultPlain.subject);
  const [body, setBody] = useState(split?.plain_body ?? defaultPlain.body);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (enabled: boolean) =>
    start(async () => {
      const r = await updateSplitTest(campaignId, { enabled, plainSubject: subject, plainBody: body });
      if ("error" in r) setMsg(r.error);
      else {
        setOn(enabled);
        setMsg(enabled ? "Saved. When the campaign runs, half the leads get this plain copy." : "Split test off.");
      }
    });
  return (
    <div className="rounded-xl bg-amber-50/60 p-3 ring-1 ring-amber-200">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-slate-800">Split test 50/50 (admin)</div>
        <span className={on ? "text-xs font-medium text-amber-800" : "text-xs text-slate-500"}>{on ? "On" : "Off"}</span>
      </div>
      <p className="mt-1 text-xs text-slate-600">
        Half the leads get your plain copy (holdout, no credits), half get FirstLine, from the same inboxes on the same schedule. The fit check is off in a split test, so
        both halves reach the same kind of leads. Reply rates per half are on /admin.
      </p>
      {!locked && (
        <>
          <label className="mt-2 block text-xs font-medium text-slate-700" htmlFor="split-subject">
            Plain subject
          </label>
          <input id="split-subject" className={`${inputClass} mt-1`} value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} disabled={pending} />
          <label className="mt-2 block text-xs font-medium text-slate-700" htmlFor="split-body">
            Plain copy (your email without the personalised spots)
          </label>
          <textarea id="split-body" className={`${inputClass} mt-1 min-h-28 font-mono text-xs`} value={body} onChange={(e) => setBody(e.target.value)} disabled={pending} />
          <div className="mt-2 flex items-center gap-3">
            <button type="button" className={buttonClass("secondary", "py-1.5 text-xs")} disabled={pending} onClick={() => save(true)}>
              {pending ? "Saving…" : on ? "Save plain copy" : "Turn on 50/50 split"}
            </button>
            {on && (
              <button type="button" className="text-xs text-slate-500 hover:underline" disabled={pending} onClick={() => save(false)}>
                Turn off
              </button>
            )}
          </div>
        </>
      )}
      {locked && <p className="mt-1 text-xs text-slate-500">Set before the run; it can&apos;t change once leads are split.</p>}
      {msg && <p className="mt-1 text-xs text-slate-700">{msg}</p>}
    </div>
  );
}
