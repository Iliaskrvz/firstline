"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { accept } from "./actions";

export function AcceptButton({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Button
        className="w-full"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await accept(token);
            if (r?.error) setError(r.error);
          })
        }
      >
        {pending ? "Joining…" : "Accept and join"}
      </Button>
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </div>
  );
}
