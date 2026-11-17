"use client";

// Shown when a page fails to render. The error itself is logged on the server; nothing technical is shown here.
import Link from "next/link";
import { buttonClass, Logo } from "@/components/ui";
import { SYSTEM } from "@/content/system";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = SYSTEM.error;
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center px-4 py-16 text-center text-slate-900">
      <Logo />
      <h1 className="mt-10 text-2xl font-semibold tracking-tight">{t.title}</h1>
      <p className="mt-3 max-w-md text-slate-600">{t.text}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className={buttonClass("primary", "rounded-full px-5")}>
          {t.retry}
        </button>
        <Link href="/" className={buttonClass("secondary", "rounded-full px-5")}>
          {t.home}
        </Link>
      </div>
    </main>
  );
}
