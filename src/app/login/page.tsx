import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, Logo } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-semibold text-slate-900">Sign in or create an account</h1>
        <p className="mt-1 text-sm text-slate-500">We&apos;ll email you a magic link. No password needed.</p>
        <Suspense>
          <LoginInner searchParams={props.searchParams} />
        </Suspense>
      </Card>
    </div>
  );
}

async function LoginInner({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const next = typeof sp.next === "string" ? sp.next : null;
  return <LoginForm initialError={error} next={next} />;
}
