import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, PageHeader, Skeleton } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { signInOptions } from "@/lib/auth-options";
import { PasskeyList, PasswordForm } from "./account-forms";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage(props: PageProps<"/settings/account">) {
  return (
    <>
      <PageHeader title="Account" description="How you sign in to FirstLine." />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Account searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Account({ searchParams }: { searchParams: PageProps<"/settings/account">["searchParams"] }) {
  const { supabase, user } = await requireUser();
  const reset = (await searchParams).reset === "1";
  const { data } = await supabase.auth.getUser();
  const options = await signInOptions();
  const providers = new Set((data.user?.identities ?? []).map((i) => i.provider));
  return (
    <div className="space-y-6">
      <Card className="space-y-1 text-sm">
        <div className="text-slate-500">Signed in as</div>
        <div className="font-medium text-slate-900">{user.email}</div>
        {providers.has("google") && <div className="text-xs text-slate-500">Google sign-in is linked to this account.</div>}
      </Card>
      <Card className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">{reset ? "Choose a new password" : "Password"}</h2>
        <p className="text-sm text-slate-600">
          {reset ? "You opened a reset link. Choose a new password to finish." : "Set or change the password you use with your email address."}
        </p>
        <PasswordForm email={user.email ?? ""} highlight={reset} />
      </Card>
      <Card className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Passkeys</h2>
        <p className="text-sm text-slate-600">
          Sign in with your fingerprint, face or device PIN instead of a password. Add one for each device you use (your phone can also sign in on another computer).
        </p>
        {options.passkeys ? <PasskeyList /> : <p className="text-sm text-slate-500">Passkeys aren&apos;t switched on yet.</p>}
      </Card>
    </div>
  );
}
