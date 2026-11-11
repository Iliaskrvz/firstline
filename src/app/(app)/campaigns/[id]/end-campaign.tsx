"use client";

import { useTransition } from "react";
import { endCampaignAction } from "../actions";

export function EndCampaign({ campaignId, endedAt, purged }: { campaignId: string; endedAt: string | null; purged: boolean }) {
  const [pending, start] = useTransition();
  if (purged) return <p className="text-xs text-slate-500">This campaign ended; its lead data was deleted after 30 days (§11).</p>;
  if (endedAt) {
    const deleteOn = new Date(new Date(endedAt).getTime() + 30 * 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    return <p className="text-xs text-slate-500">Campaign ended. Lead data (names, emails, written emails) is deleted on {deleteOn}; export it before then if you need it.</p>;
  }
  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs font-medium text-slate-500 hover:text-rose-700 hover:underline"
      onClick={() => {
        if (!confirm("End this campaign? Sending stops, unused reserved credits come back, and the lead data is deleted 30 days from now.")) return;
        start(async () => void (await endCampaignAction(campaignId)));
      }}
    >
      {pending ? "Ending…" : "End campaign"}
    </button>
  );
}
