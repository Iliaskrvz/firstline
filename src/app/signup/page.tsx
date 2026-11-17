import type { Metadata } from "next";
import { SIGNUP } from "@/content/auth";
import { pageMetadata } from "@/content/meta";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Logo } from "@/components/ui";
import { signInOptions } from "@/lib/auth-options";
import { parsePublicDomain } from "@/lib/public-host";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = pageMetadata("signup");

export default function SignupPage(props: PageProps<"/signup">) {
  return (
    <div className="bg-grid flex min-h-screen flex-col items-center justify-center bg-white px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-semibold text-slate-900">{SIGNUP.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{SIGNUP.sub}</p>
        <ul className="mt-3 space-y-1 text-sm text-slate-700">
          {SIGNUP.reassure.map((r) => (
            <li key={r} className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="size-3.5 text-emerald-700" aria-hidden>
                <path d="M20 6 9 17l-5-5" />
              </svg>
              {r}
            </li>
          ))}
        </ul>
        <Suspense>
          <Inner searchParams={props.searchParams} />
        </Suspense>
      </Card>
      <p className="mt-6 max-w-sm text-center text-xs text-slate-500">
        By continuing you agree to the <Link href="/terms" className="underline">terms</Link>, including the <Link href="/dpa" className="underline">DPA</Link>, and the{" "}
        <Link href="/privacy" className="underline">privacy policy</Link>.
      </p>
    </div>
  );
}

async function Inner({ searchParams }: { searchParams: PageProps<"/signup">["searchParams"] }) {
  const sp = await searchParams;
  // Coming from the homepage demo: say what's next (the domain is only shown, never stored).
  const demo = typeof sp.demo === "string" ? parsePublicDomain(sp.demo) : null;
  return (
    <>
      {demo && (
        <p className="mt-4 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
          You tried FirstLine on {demo}. Create your account, then upload your own leads: 25 personalised emails are free.
        </p>
      )}
      <SignupForm next={typeof sp.next === "string" ? sp.next : null} google={(await signInOptions()).google} />
    </>
  );
}
