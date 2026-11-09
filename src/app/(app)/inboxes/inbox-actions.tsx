"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { newInboxKey, pauseInbox } from "./actions";
import { SetupSteps } from "./setup-steps";

export function InboxActions({ inboxId, paused, appUrl, script }: { inboxId: string; paused: boolean; appUrl: string | null; script: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ key: string; email: string } | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await pauseInbox(inboxId, !paused);
              setError(res?.error ?? null);
            })
          }
        >
          {paused ? "Resume sending" : "Pause sending"}
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (!confirm("Create a new key? The old key stops working right away; you'll paste the new one in the sheet (FirstLine → Connect…).")) return;
            start(async () => {
              const res = await newInboxKey(inboxId);
              if ("error" in res) setError(res.error);
              else setFresh(res);
            });
          }}
        >
          New key / setup steps
        </Button>
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      {fresh && <SetupSteps email={fresh.email} senderKey={fresh.key} appUrl={appUrl} script={script} />}
    </div>
  );
}
