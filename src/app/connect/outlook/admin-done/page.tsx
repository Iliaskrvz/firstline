// Where Microsoft sends the customer's admin after the approval link. Public: the admin has no FirstLine account.
import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, Logo } from "@/components/ui";

export const metadata: Metadata = { title: "FirstLine approved", robots: { index: false } };

export default function AdminDonePage(props: PageProps<"/connect/outlook/admin-done">) {
  return (
    <div className="bg-grid flex min-h-screen flex-col items-center justify-center bg-white px-4 py-12">
      <Logo />
      <Suspense>
        <Result searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function Result({ searchParams }: { searchParams: PageProps<"/connect/outlook/admin-done">["searchParams"] }) {
  const sp = await searchParams;
  const ok = sp.admin_consent === "True" && !sp.error;
  return (
    <Card className="mt-8 max-w-md space-y-2 text-sm text-slate-700">
      <h1 className="text-lg font-semibold text-slate-900">{ok ? "FirstLine is approved for your organisation" : "FirstLine wasn't approved"}</h1>
      {ok ? (
        <p>Thanks. Your colleague can now go back to FirstLine and click Check again to connect their inbox. You don&apos;t need to do anything else.</p>
      ) : (
        <p>
          Microsoft didn&apos;t complete the approval{typeof sp.error === "string" ? ` (${sp.error})` : ""}. Make sure you sign in with an account that can approve
          apps (Global Administrator, Cloud Application Administrator or Application Administrator), then open the link again.
        </p>
      )}
    </Card>
  );
}
