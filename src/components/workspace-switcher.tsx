"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { switchWorkspace } from "@/app/(app)/workspace-actions";

export function WorkspaceSwitcher({ current, options }: { current: string; options: { id: string; name: string; role: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Workspace"
      className="max-w-48 truncate rounded-lg border-0 bg-transparent py-0 pl-0 pr-6 text-right text-sm font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500"
      value={current}
      disabled={pending}
      onChange={(e) =>
        start(async () => {
          const r = await switchWorkspace(e.target.value);
          if (!("error" in r)) {
            router.push("/campaigns");
            router.refresh();
          }
        })
      }
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
