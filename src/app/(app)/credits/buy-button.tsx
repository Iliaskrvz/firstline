"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { buyPack } from "./actions";

export function BuyButton({ pack, label, disabled }: { pack: string; label: string; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1.5">
      <Button
        className="w-full"
        disabled={pending || disabled}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await buyPack(pack);
            if (res?.error) setError(res.error);
          })
        }
      >
        {pending ? "Opening Stripe…" : label}
      </Button>
      {error && <p className="text-xs text-rose-700">{error}</p>}
    </div>
  );
}
