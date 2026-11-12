import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Logo } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/team";
import { serverPool } from "@/server/db";
import { inviteByToken } from "@/teams/db";
import { AcceptButton } from "./accept-button";

export const metadata: Metadata = { title: "Join a workspace" };

export default function InvitePage(props: PageProps<"/invite/[token]">) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <Card className="w-full max-w-md space-y-4">
        <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
          <Invite params={props.params} />
        </Suspense>
      </Card>
    </div>
  );
}

async function Invite({ params }: { params: PageProps<"/invite/[token]">["params"] }) {
  const { token } = await params;
  const { user } = await requireUser();
  const i = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await inviteByToken(serverPool(), token) : null;
  if (!i || i.status !== "open") {
    const msg = !i || i.status === "revoked" ? "This invite link is not valid (anymore)." : i.status === "accepted" ? "This invite was already used." : "This invite has expired.";
    return (
      <>
        <h1 className="text-lg font-semibold text-slate-900">Invite not available</h1>
        <p className="text-sm text-slate-600">{msg} Ask the person who invited you for a new link.</p>
        <Link href="/campaigns" className="text-sm font-medium text-indigo-700 hover:underline">
          Go to FirstLine →
        </Link>
      </>
    );
  }
  const sameEmail = (user.email ?? "").toLowerCase() === i.email.toLowerCase();
  return (
    <>
      <h1 className="text-lg font-semibold text-slate-900">Join {i.workspace_name}</h1>
      <p className="text-sm text-slate-600">
        You were invited as <strong>{ROLE_LABEL[i.role].toLowerCase()}</strong>. You&apos;ll share this workspace&apos;s campaigns, inboxes and credits. Your own
        workspace stays; switch between them at the top right.
      </p>
      {sameEmail ? (
        <AcceptButton token={token} />
      ) : (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This invite is for <strong>{i.email}</strong>, but you&apos;re signed in as {user.email}. Sign out and sign in with {i.email} to accept it.
        </p>
      )}
    </>
  );
}
