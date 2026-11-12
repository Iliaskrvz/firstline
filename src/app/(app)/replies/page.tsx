import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, Card, PageHeader, Skeleton, Stat } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { formatDate, n } from "@/lib/format";
import { RemoveButton } from "./remove-button";

export const metadata: Metadata = { title: "Replies" };

const REASON: Record<string, string> = { replied: "Replied", unsub: "Asked to stop", bounce: "Bounced", manual: "Added by you" };

export default function RepliesPage() {
  return (
    <>
      <PageHeader title="Replies" description="Everyone who answered or bounced, across all campaigns. Only the fact that they replied reaches FirstLine; the reply itself stays in your Gmail." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Replies />
      </Suspense>
    </>
  );
}

type Send = { id: string; lead_id: string; campaign_id: string; inbox_id: string | null; step_no: number; status: string; status_detail: string | null; gmail_thread_id: string | null; replied_at: string | null; bounced_at: string | null; sent_at: string | null };

async function Replies() {
  const { supabase, workspace } = await requireWorkspace();
  const [{ data: sendRows }, { data: suppressed }, { data: inboxRows }, { data: campaignRows }] = await Promise.all([
    supabase
      .from("sends")
      .select("id, lead_id, campaign_id, inbox_id, step_no, status, status_detail, gmail_thread_id, replied_at, bounced_at, sent_at")
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: false })
      .limit(5000),
    supabase.from("suppression").select("email, domain, reason, created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(1000),
    supabase.from("inboxes").select("id, email").eq("workspace_id", workspace.id),
    supabase.from("campaigns").select("id, name").eq("workspace_id", workspace.id).eq("source", "app"),
  ]);
  const sends = (sendRows ?? []) as Send[];
  const answered = sends.filter((s) => s.status === "replied" || s.status === "bounced");
  const { data: leadRows } = answered.length
    ? await supabase.from("leads").select("id, email, first_name, last_name, company").in("id", [...new Set(answered.map((s) => s.lead_id))])
    : { data: [] };
  const leads = new Map((leadRows ?? []).map((l) => [l.id, l]));
  const inboxes = new Map((inboxRows ?? []).map((i) => [i.id, i.email as string]));
  const campaigns = new Map((campaignRows ?? []).map((c) => [c.id, c.name as string]));

  const contacted = new Set(sends.map((s) => s.lead_id)).size;
  const repliedLeads = new Set(sends.filter((s) => s.status === "replied").map((s) => s.lead_id)).size;
  const bouncedLeads = new Set(sends.filter((s) => s.status === "bounced").map((s) => s.lead_id)).size;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Emails sent" value={n(sends.length)} />
        <Stat label="Leads contacted" value={n(contacted)} />
        <Stat label="Reply rate" value={contacted ? `${Math.round((repliedLeads / contacted) * 100)}%` : "–"} tone="green" />
        <Stat label="Bounce rate" value={contacted ? `${Math.round((bouncedLeads / contacted) * 100)}%` : "–"} tone={bouncedLeads ? "amber" : undefined} />
      </div>

      <Card className="overflow-hidden p-0">
        <h2 className="px-6 py-4 text-base font-semibold text-slate-900">Replies and bounces</h2>
        {answered.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-slate-500">No replies yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-2.5">Lead</th>
                  <th className="px-6 py-2.5">Campaign</th>
                  <th className="px-6 py-2.5">After</th>
                  <th className="px-6 py-2.5">What</th>
                  <th className="px-6 py-2.5">When</th>
                  <th className="px-6 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {answered.map((s) => {
                  const l = leads.get(s.lead_id);
                  const inbox = s.inbox_id ? inboxes.get(s.inbox_id) : null;
                  return (
                    <tr key={s.id}>
                      <td className="px-6 py-2.5">
                        <div className="text-slate-900">{[l?.first_name, l?.last_name].filter(Boolean).join(" ") || l?.email}</div>
                        <div className="text-xs text-slate-500">
                          {l?.email}
                          {l?.company && ` · ${l.company}`}
                        </div>
                      </td>
                      <td className="px-6 py-2.5">
                        <Link href={`/campaigns/${s.campaign_id}`} className="text-brand-700 hover:underline">
                          {campaigns.get(s.campaign_id) ?? "Campaign"}
                        </Link>
                      </td>
                      <td className="px-6 py-2.5 text-slate-600">{s.step_no === 1 ? "first email" : `follow-up ${s.step_no}`}</td>
                      <td className="px-6 py-2.5">
                        <Badge tone={s.status === "replied" ? (s.status_detail ? "amber" : "green") : "red"}>{s.status_detail ?? (s.status === "replied" ? "Replied" : "Bounced")}</Badge>
                      </td>
                      <td className="px-6 py-2.5 text-slate-600">{formatDate((s.replied_at ?? s.bounced_at ?? s.sent_at)!)}</td>
                      <td className="px-6 py-2.5 text-right">
                        {s.gmail_thread_id && inbox && (
                          <a
                            className="text-xs font-medium text-brand-700 hover:underline"
                            href={`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(inbox)}#all/${s.gmail_thread_id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open in Gmail
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">Do-not-contact list</h2>
          <p className="mt-0.5 text-xs text-slate-500">FirstLine never emails these again, in any campaign. Replies, &quot;stop&quot; and bounces are added automatically.</p>
        </div>
        {(suppressed ?? []).length === 0 ? (
          <p className="px-6 pb-6 text-sm text-slate-500">Empty.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {(suppressed ?? []).map((x) => (
              <li key={`${x.email}-${x.domain}-${x.created_at}`} className="flex items-center justify-between gap-3 px-6 py-2.5">
                <span className="text-slate-900">{x.email ?? `@${x.domain}`}</span>
                <span className="flex items-center gap-4">
                  <span className="text-xs text-slate-500">
                    {REASON[x.reason] ?? x.reason} · {formatDate(x.created_at)}
                  </span>
                  <RemoveButton email={x.email} domain={x.domain} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
