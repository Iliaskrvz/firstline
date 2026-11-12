import type { Metadata } from "next";
import { Suspense } from "react";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { can, ROLE_LABEL } from "@/lib/team";
import { serverPool } from "@/server/db";
import { queueConfigured } from "@/server/queue";
import { members, openInvites } from "@/teams/db";
import { CancelInvite, InviteForm, MemberActions } from "./team-forms";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <>
      <PageHeader title="Team" description="Everyone in a workspace shares its campaigns, inboxes and credits. Seats are free." />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Team />
      </Suspense>
    </>
  );
}

async function Team() {
  const { workspace, user, role } = await requireWorkspace();
  if (!queueConfigured()) return <Card className="text-sm text-slate-600">Teams need the database connection (DATABASE_URL in .env.local).</Card>;
  const pool = serverPool();
  const [list, invites] = await Promise.all([members(pool, workspace.id), openInvites(pool, workspace.id)]);
  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <h2 className="text-base font-semibold text-slate-900">{workspace.name}</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {list.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div>
                <span className="font-medium text-slate-900">{m.email}</span>
                {m.user_id === user.id && <span className="text-slate-500"> (you)</span>} <Badge tone={m.role === "owner" ? "indigo" : "gray"}>{ROLE_LABEL[m.role]}</Badge>
                <div className="text-xs text-slate-500">Joined {formatDate(m.joined_at.toISOString())}</div>
              </div>
              <MemberActions
                userId={m.user_id}
                email={m.email}
                role={m.role}
                isSelf={m.user_id === user.id}
                canRemove={can("remove", role, m.role, m.user_id === user.id)}
                canChangeRole={can("change_role", role, m.role, m.user_id === user.id)}
                canTransfer={can("transfer", role, m.role, m.user_id === user.id)}
              />
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-500">
          Owner and admins: buy credits, manage integrations, API keys and the team. Members: everything else (campaigns, inboxes, sending, pushing).
        </p>
      </Card>

      {can("invite", role, null) && (
        <Card className="space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Invite someone</h2>
          <InviteForm />
          {invites.length > 0 && (
            <div>
              <div className="text-sm font-medium text-slate-700">Open invites</div>
              <ul className="mt-1 divide-y divide-slate-100 text-sm">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      {i.email} · {ROLE_LABEL[i.role]} <span className="text-xs text-slate-500">· expires {formatDate(i.expires_at.toISOString())}</span>
                    </span>
                    <CancelInvite id={i.id} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
