"use client";

import { useTransition } from "react";
import { setSenderDisabled } from "./actions";

export function SenderSwitch({ workspaceId, disabled }: { workspaceId: string; disabled: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={disabled ? "text-xs font-medium text-emerald-700 hover:underline" : "text-xs font-medium text-rose-700 hover:underline"}
      onClick={() => {
        if (!disabled && !confirm("Turn off sending for this workspace? Its Sender Sheets get nothing until you turn it on again.")) return;
        start(async () => void (await setSenderDisabled(workspaceId, !disabled)));
      }}
    >
      {pending ? "…" : disabled ? "Turn sending on" : "Turn sending off"}
    </button>
  );
}
