import Link from "next/link";
import { buttonClass, Logo } from "@/components/ui";

export default function Home() {
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Logo />
        <Link href="/login" className={buttonClass("secondary")}>
          Sign in
        </Link>
      </header>
      <main className="flex flex-1 flex-col justify-center pb-24">
        <p className="text-sm font-medium text-indigo-600">Pay per email. No subscription.</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
          Your cold email. Researched first lines.
        </h1>
        <p className="mt-5 max-w-xl text-lg text-slate-600">
          Upload your leads, paste your own copy with a few marked slots, and FirstLine writes only those slots, based on
          real facts from each company&apos;s website. Every claim is cited. No facts, no charge.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/login" className={buttonClass("primary", "px-5 py-2.5")}>
            Get started free
          </Link>
        </div>
      </main>
    </div>
  );
}
