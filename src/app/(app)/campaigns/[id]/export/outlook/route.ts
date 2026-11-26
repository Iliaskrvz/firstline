// GET /campaigns/[id]/export/outlook?followups=1&merge=1&optout=…: "Download for Outlook".
// A ZIP with one .eml draft per lead (src/lib/outlook-export.ts). Free: the credits were paid when the
// emails were written. Logged in the activity log and as outcomes (channel "outlook", status "exported").
import type { NextRequest } from "next/server";
import { detectLanguage } from "@/engine/language";
import { requireWorkspace } from "@/lib/auth";
import { buildOutlookZip, outlookZipName } from "@/lib/outlook-export";
import { defaultOptOutLine } from "@/lib/sender/messages";
import { loadOutlookDrafts } from "@/sender/outlook-export-db";
import { serverPool } from "@/server/db";
import { logActivity } from "@/teams/db";

export async function GET(request: NextRequest, ctx: RouteContext<"/campaigns/[id]/export/outlook">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const { supabase, workspace, user } = await requireWorkspace();
  // RLS check: the campaign must be visible to this user.
  const { data: campaign } = await supabase.from("campaigns").select("id, name, opt_out_line, templates(body)").eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
  if (!campaign) return new Response("Not found", { status: 404 });

  const q = request.nextUrl.searchParams;
  const includeFollowUps = q.get("followups") === "1";
  const mailMerge = q.get("merge") === "1";
  const tplBody = (campaign.templates as unknown as { body: string } | null)?.body;
  const fallbackLine = campaign.opt_out_line ?? defaultOptOutLine(tplBody ? detectLanguage(tplBody) : "en");
  // The opt-out line as set on the Send step; one line, at most 200 characters, empty = none.
  const optOutLine = q.has("optout") ? (q.get("optout") ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200) : fallbackLine;

  const pool = serverPool();
  const drafts = await loadOutlookDrafts(pool, { workspaceId: workspace.id, campaignId: id, includeFollowUps, optOutLine: optOutLine || null });
  if (drafts.leads.length === 0) return new Response("Nothing to export yet: no finished emails (or all of them are on the suppression list).", { status: 409 });

  const zip = buildOutlookZip({ campaign: campaign.name, leads: drafts.leads, mailMerge, invalidLeftOut: drafts.invalid });

  const followUps = drafts.leads.reduce((s, l) => s + l.followUps.length, 0);
  await logActivity(pool, {
    workspaceId: workspace.id,
    userId: user.id,
    actor: user.email ?? "Member",
    action: "campaign.exported",
    target: campaign.name,
    details: { format: "outlook", drafts: drafts.leads.length, followUps, mailMerge, suppressed: drafts.suppressed },
  }).catch((e) => console.error("outlook export: activity log failed:", (e as Error).message));
  await pool.query("select public.record_outcomes($1::uuid[], 1, 'outlook', 'exported')", [drafts.leadIds]).catch(() => {});

  return new Response(zip as unknown as BodyInit, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${outlookZipName(campaign.name)}"`,
      "cache-control": "no-store",
    },
  });
}
