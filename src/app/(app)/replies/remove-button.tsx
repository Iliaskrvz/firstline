"use client";

import { useTransition } from "react";
import { removeSuppression } from "./actions";

export function RemoveButton({ email, domain }: { email: string | null; domain: string | null }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs font-medium text-indigo-700 hover:underline disabled:text-slate-400"
      onClick={() => {
        if (!confirm(`Allow emailing ${email ?? domain} again?`)) return;
        start(async () => void (await removeSuppression({ email, domain })));
      }}
    >
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}
