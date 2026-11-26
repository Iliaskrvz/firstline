// Local development and tests only (fake Microsoft 365): choose what Microsoft would do, without an account.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Card } from "@/components/ui";
import { FakeMicrosoft } from "@/sender/microsoft-fake";
import { microsoftMode } from "@/sender/microsoft-config";

export const metadata: Metadata = { title: "Fake Microsoft sign-in", robots: { index: false } };

export default function FakeSignIn(props: PageProps<"/connect/outlook/fake">) {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Suspense>
        <Choices searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function Choices({ searchParams }: { searchParams: PageProps<"/connect/outlook/fake">["searchParams"] }) {
  if (microsoftMode() !== "fake") notFound();
  const sp = await searchParams;
  const state = typeof sp.state === "string" ? sp.state : "";
  const email = "you@contoso.test";
  const cb = (q: Record<string, string>) => `/connect/outlook/callback?${new URLSearchParams({ ...q, state }).toString()}`;
  const link = "block rounded-lg px-3 py-2 ring-1 ring-slate-200 hover:bg-slate-50";
  return (
    <Card className="space-y-3 text-sm">
      <p className="font-mono text-xs text-amber-700">Fake Microsoft 365 (no MICROSOFT_CLIENT_ID): nothing leaves this computer.</p>
      <h1 className="text-lg font-semibold">Sign in as {email}</h1>
      <a className={link} href={cb({ code: FakeMicrosoft.code(email) })}>Approve (you&apos;re an admin, or your organisation allows it)</a>
      <a className={link} href={cb({ error: "access_denied", error_description: "AADSTS90094: The grant requires admin permission." })}>Needs admin approval (you&apos;re not an admin)</a>
      <a className={link} href={cb({ code: FakeMicrosoft.code(email, false) })}>Approve without Mail.Send (a policy removed it)</a>
      <a className={link} href={cb({ error: "access_denied", error_description: "AADSTS65004: User declined to consent." })}>Cancel</a>
    </Card>
  );
}
