import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Logo } from "@/components/ui";
import { signInOptions } from "@/lib/auth-options";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create an account" };

export default function SignupPage(props: PageProps<"/signup">) {
  return (
    <div className="bg-grid flex min-h-screen flex-col items-center justify-center bg-white px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-semibold text-slate-900">Create your account</h1>
        <p className="mt-1 text-sm text-slate-500">25 free credits after you confirm your email address.</p>
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
  return <SignupForm next={typeof sp.next === "string" ? sp.next : null} google={(await signInOptions()).google} />;
}
