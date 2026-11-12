// GET /campaigns/[id]/export: the campaign as CSV with fl_ columns (§8 Lane B).
import Papa from "papaparse";
import type { NextRequest } from "next/server";
import { requireWorkspace } from "@/lib/auth";
import { buildExport, exportFileName, type ExportGeneration, type ExportLead } from "@/lib/export";
import { parseTemplate } from "@/lib/template";
import { serverPool } from "@/server/db";

export async function GET(_request: NextRequest, ctx: RouteContext<"/campaigns/[id]/export">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const { supabase, workspace } = await requireWorkspace();
  // RLS check: the campaign must be visible to this user.
  const { data: campaign } = await supabase.from("campaigns").select("id, name, templates(subject, body)").eq("id", id).eq("workspace_id", workspace.id).maybeSingle();
  if (!campaign) return new Response("Not found", { status: 404 });

  const pool = serverPool();
  const { rows: leads } = await pool.query<ExportLead>(
    `select id, email, first_name, last_name, company, title, linkedin_headline, website, domain, custom, status, status_detail, confidence
       from public.leads where campaign_id = $1 and workspace_id = $2 order by created_at, id`,
    [id, workspace.id],
  );
  const { rows: generations } = await pool.query<ExportGeneration>(
    `select distinct on (g.lead_id, g.step_no) g.lead_id, g.step_no, g.subject, g.full_email, g.slot_outputs, g.facts_used, g.research
       from public.generations g join public.leads l on l.id = g.lead_id
      where l.campaign_id = $1 and l.workspace_id = $2
      order by g.lead_id, g.step_no, g.created_at desc`,
    [id, workspace.id],
  );
  const { rows: steps } = await pool.query<{ step_no: number }>(
    "select step_no from public.sequence_steps where campaign_id = $1 and kind = 'personalised' order by step_no",
    [id],
  );
  const tpl = campaign.templates as unknown as { subject: string; body: string } | null;
  const slotKeys = tpl ? parseTemplate(tpl).slots.map((s) => s.key) : [];

  // Outcome rows for the reply-rate loop (no personal data): these emails left FirstLine as CSV.
  const written = leads.filter((l) => l.status === "done" || l.status === "fallback").map((l) => l.id);
  if (written.length) await pool.query("select public.record_outcomes($1::uuid[], 1, 'csv', 'exported')", [written]).catch(() => {});

  const { headers, rows } = buildExport(leads, generations, { slotKeys, followUpSteps: steps.map((s) => s.step_no) });
  // BOM so Excel opens accents (é, ë, ß) correctly.
  const csv = "﻿" + Papa.unparse({ fields: headers, data: rows });
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFileName(campaign.name)}"`,
      "cache-control": "no-store",
    },
  });
}
