"use client";

import { useTransition } from "react";
import { setOwnUse } from "./actions";

/** Admin only: this workspace uses real Claude (own use) instead of the server's provider. */
export function OwnUseSwitch({ workspaceId, on }: { workspaceId: string; on: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={on ? "text-xs font-medium text-slate-600 hover:underline" : "text-xs font-medium text-brand-700 hover:underline"}
      onClick={() => {
        if (!on && !confirm("Let this workspace use real Claude (own use)? Its AI and website costs are logged as own use, up to the monthly cap.")) return;
        start(async () => void (await setOwnUse(workspaceId, !on)));
      }}
    >
      {pending ? "…" : on ? "Stop own use (Claude)" : "Own use: real Claude"}
    </button>
  );
}
