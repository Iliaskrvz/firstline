import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass, Logo } from "@/components/ui";
import { SYSTEM } from "@/content/system";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  const t = SYSTEM.notFound;
  return (
    <main className="bg-paper flex min-h-screen flex-col items-center justify-center px-4 py-16 text-center text-slate-900">
      <Link href="/" aria-label="FirstLine, home">
        <Logo />
      </Link>
      <p className="mt-10 font-mono text-[13px] text-slate-600">
        <span className="text-brand-700">[{t.code}]</span>
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t.title}</h1>
      <p className="mt-3 max-w-md text-slate-600">{t.text}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/" className={buttonClass("primary", "rounded-full px-5")}>
          {t.home}
        </Link>
        <Link href="/campaigns" className={buttonClass("secondary", "rounded-full px-5")}>
          {t.app}
        </Link>
      </div>
    </main>
  );
}
