"use client";

// "Download for Outlook" on the Send step: drafts to open in the customer's own Outlook. Free.
import { useState } from "react";
import { buttonClass, inputClass } from "@/components/ui";

export function OutlookExport({ campaignId, followUpSteps, defaultOptOut }: { campaignId: string; followUpSteps: number[]; defaultOptOut: string }) {
  const [followUps, setFollowUps] = useState(false);
  const [merge, setMerge] = useState(false);
  const [optOut, setOptOut] = useState(defaultOptOut);
  const q = new URLSearchParams({ ...(followUps ? { followups: "1" } : {}), ...(merge ? { merge: "1" } : {}), optout: optOut });
  return (
    <details className="group rounded-xl ring-1 ring-slate-200">
      <summary className="cursor-pointer list-none px-4 py-3 text-center text-sm font-medium text-brand-700 hover:underline [&::-webkit-details-marker]:hidden">
        Download for Outlook (drafts) ↓
      </summary>
      <div className="space-y-3 border-t border-slate-100 px-4 py-4 text-sm">
        <p className="text-slate-600">
          A ZIP with one email draft per lead (.eml). Open them in Outlook and send them yourself, at most ~30 a day per inbox. Free: no credits used.
        </p>
        {followUpSteps.length > 0 && (
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 accent-brand-600" checked={followUps} onChange={(e) => setFollowUps(e.target.checked)} />
            <span>
              Include follow-ups (step {followUpSteps.join(", ")})
              <span className="block text-xs text-slate-500">
                As separate new emails, not replies in the same thread. To keep the thread, reply to your sent first email and paste the text.
              </span>
            </span>
          </label>
        )}
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 accent-brand-600" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
          <span>
            Also a mail-merge CSV
            <span className="block text-xs text-slate-500">For Word&apos;s email merge. Works with classic Outlook for Windows only.</span>
          </span>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Opt-out line (empty = none)</span>
          <input className={`${inputClass} mt-1`} value={optOut} onChange={(e) => setOptOut(e.target.value)} maxLength={200} />
        </label>
        <a href={`/campaigns/${campaignId}/export/outlook?${q.toString()}`} className={buttonClass("secondary", "w-full")} download>
          Download ZIP
        </a>
      </div>
    </details>
  );
}
