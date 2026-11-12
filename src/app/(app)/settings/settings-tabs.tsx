"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const TABS = [
  { href: "/settings/team", label: "Team" },
  { href: "/settings/activity", label: "Activity" },
  { href: "/settings/api", label: "API" },
];

export function SettingsTabs() {
  const path = usePathname();
  return (
    <nav className="mb-6 flex gap-1 border-b border-slate-200">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cx("-mb-px border-b-2 px-3 py-2 text-sm font-medium", path.startsWith(t.href) ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-600 hover:text-slate-900")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
