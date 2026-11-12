import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Logo } from "@/components/ui";
import { signInOptions } from "@/lib/auth-options";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-semibold text-slate-900">Sign in</h1>
        <p className="mt-1 text-sm text-slate-500">Welcome back.</p>
        <Suspense>
          <LoginInner searchParams={props.searchParams} />
        </Suspense>
      </Card>
      <p className="mt-6 max-w-sm text-center text-xs text-slate-500">
        By continuing you agree to the <Link href="/terms" className="underline">terms</Link>, including the <Link href="/dpa" className="underline">DPA</Link>, and the <Link href="/privacy" className="underline">privacy policy</Link>.
      </p>
    </div>
  );
}

async function LoginInner({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const next = typeof sp.next === "string" ? sp.next : null;
  return <LoginForm initialError={error} next={next} options={await signInOptions()} />;
}
