"use client";

import { useTransition } from "react";
import { resumeLeadSend } from "../actions";

export function ResumeButton({ campaignId, sendId }: { campaignId: string; sendId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs font-medium text-indigo-700 hover:underline disabled:text-slate-400"
      onClick={() => start(async () => void (await resumeLeadSend(campaignId, sendId)))}
    >
      {pending ? "Resuming…" : "Resume"}
    </button>
  );
}
