// When Microsoft says the user can't approve FirstLine themselves: what to send to their IT person.
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { buttonClass, Card, PageHeader, Skeleton } from "@/components/ui";
import { randomToken } from "@/lib/secret-box";
import { adminConsentUrl } from "@/sender/microsoft";
import { microsoftMode } from "@/sender/microsoft-config";
import { adminDoneUri, connectOrigin } from "@/server/outlook-connect";
import { CopyLink } from "./copy-link";

export const metadata: Metadata = { title: "Approve FirstLine in Microsoft 365" };

export default function OutlookApprovalPage(props: PageProps<"/inboxes/outlook">) {
  return (
    <>
      <PageHeader title="Your organisation needs to approve FirstLine" description="Microsoft 365 lets only an admin approve apps like FirstLine in many organisations." />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Approval searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Approval({ searchParams }: { searchParams: PageProps<"/inboxes/outlook">["searchParams"] }) {
  const sp = await searchParams;
  const origin = connectOrigin(await headers(), "http://localhost:3000");
  const mode = microsoftMode();
  const link =
    mode === "real" ? adminConsentUrl({ clientId: process.env.MICROSOFT_CLIENT_ID!.trim(), redirectUri: adminDoneUri(origin), state: randomToken(12) }) : `${origin}/connect/outlook/admin-done?admin_consent=True&fake=1`;
  const missing = typeof sp.missing === "string" ? sp.missing : null;
  const code = typeof sp.code === "string" ? sp.code : null;
  return (
    <div className="max-w-2xl space-y-6">
      <Card className="space-y-4 text-sm leading-relaxed text-slate-700">
        <p>
          {missing
            ? `Microsoft connected your account but didn't grant ${missing.replace(",", " and ")}, which FirstLine needs to send.`
            : "You signed in, but your organisation only lets an admin approve new apps."}{" "}
          Send the link below to your IT person or Microsoft 365 admin. They open it, sign in with their admin account and approve
          FirstLine once for your whole organisation. Then come back here and click <strong>Check again</strong>.
        </p>
        <div>
          <p className="text-xs font-medium text-slate-500">Approval link for your admin</p>
          <CopyLink url={link} />
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <p className="font-medium text-slate-800">What your admin approves</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Sign you in and read your basic profile (User.Read).</li>
            <li>Send email as you (Mail.Send), at the slow pace you set in FirstLine.</li>
            <li>See who wrote to you, the subject and the time (Mail.ReadBasic), to stop a sequence when someone replies. FirstLine never reads the text of any email.</li>
          </ul>
        </div>
        <div className="flex flex-wrap gap-3">
          <a href="/connect/outlook/start" className={buttonClass("primary")}>
            Check again
          </a>
          <Link href="/inboxes" className={buttonClass("secondary")}>
            Back to Inboxes
          </Link>
        </div>
        {code && <p className="text-xs text-slate-400">Microsoft code: {code}</p>}
      </Card>
    </div>
  );
}
