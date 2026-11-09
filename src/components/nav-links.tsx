"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const LINKS = [
  { href: "/campaigns", label: "Campaigns" },
  { href: "/templates", label: "Templates" },
  { href: "/inboxes", label: "Inboxes" },
] as const;

export function NavLinks() {
  return <Links path={usePathname()} />;
}

/** Same links without the active state; shown while the pathname streams in. */
export function NavLinksFallback() {
  return <Links path="" />;
}

function Links({ path }: { path: string }) {
  return (
    <nav className="flex gap-1">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cx(
            "rounded-lg px-3 py-1.5 text-sm font-medium",
            path.startsWith(l.href) ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
