"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { runPreview } from "../actions";

export function PreviewButton({
  campaignId,
  label = "Run free preview (5 leads)",
  variant = "primary",
  disabledReason,
}: {
  campaignId: string;
  label?: string;
  variant?: "primary" | "secondary";
  disabledReason?: string | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        variant={variant}
        className="w-full"
        disabled={pending || !!disabledReason}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await runPreview(campaignId);
            if (res?.error) setError(res.error);
          })
        }
      >
        {pending ? "Starting…" : label}
      </Button>
      {(disabledReason || error) && <p className="text-center text-xs text-rose-700">{error ?? disabledReason}</p>}
    </div>
  );
}
