"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const LINKS = [
  { href: "/campaigns", label: "Campaigns" },
  { href: "/templates", label: "Templates" },
  { href: "/inboxes", label: "Inboxes" },
  { href: "/replies", label: "Replies" },
  { href: "/integrations", label: "Integrations" },
  { href: "/settings", label: "Settings" },
  { href: "/credits", label: "Credits" },
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
    <nav className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cx(
            "shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium",
            path.startsWith(l.href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
