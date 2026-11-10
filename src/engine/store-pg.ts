// EngineStore on Postgres (used by the worker, which connects as the database
// owner through DATABASE_URL, so RLS doesn't apply here: every query is scoped
// by the lead's own ids).
import type { Pool } from "pg";
import type { CachedResearch, EngineStore, GenerationRecord, LeadStatus } from "./store";
import type { CostEntry, LeadJob } from "./types";

export class PgStore implements EngineStore {
  constructor(private pool: Pool) {}

  async loadLeadJob(leadId: string): Promise<LeadJob | null> {
    const { rows } = await this.pool.query(
      `select l.id, l.workspace_id, l.campaign_id, l.email, l.first_name, l.last_name, l.company, l.title,
              l.linkedin_headline, l.website, l.domain, l.custom, l.status,
              c.writer, c.depth,
              t.id as t_id, t.subject, t.body, t.slots, t.style_rules, t.examples
         from public.leads l
         join public.campaigns c on c.id = l.campaign_id
         left join public.templates t on t.id = c.template_id
        where l.id = $1`,
      [leadId],
    );
    const r = rows[0];
    if (!r) return null;
    const { rows: steps } = await this.pool.query(
      `select step_no, template_body from public.sequence_steps where campaign_id = $1 and kind = 'personalised' and step_no > 1 order by step_no`,
      [r.campaign_id],
    );
    return {
      followUps: steps.map((s) => ({ step_no: s.step_no, body: s.template_body })),
      lead: {
        id: r.id, workspace_id: r.workspace_id, campaign_id: r.campaign_id, email: r.email, first_name: r.first_name,
        last_name: r.last_name, company: r.company, title: r.title, linkedin_headline: r.linkedin_headline,
        website: r.website, domain: r.domain, custom: r.custom ?? {}, status: r.status,
      },
      campaign: { id: r.campaign_id, writer: r.writer, depth: r.depth },
      template: r.t_id
        ? { id: r.t_id, subject: r.subject, body: r.body, slots: r.slots, style_rules: r.style_rules ?? {}, examples: r.examples ?? [] }
        : null,
    };
  }

  async setLeadStatus(leadId: string, status: LeadStatus, opts: { detail?: string | null; confidence?: "high" | "medium" | "low" | null } = {}) {
    const sets = ["status = $2"];
    const params: unknown[] = [leadId, status];
    if ("detail" in opts) {
      params.push(opts.detail ?? null);
      sets.push(`status_detail = $${params.length}`);
    }
    if ("confidence" in opts) {
      params.push(opts.confidence ?? null);
      sets.push(`confidence = $${params.length}`);
    }
    await this.pool.query(`update public.leads set ${sets.join(", ")} where id = $1`, params);
  }

  async getCachedResearch(domain: string): Promise<CachedResearch | null> {
    const { rows } = await this.pool.query(
      `select domain, pages, facts, status, extractor, researched_at, expires_at from public.domain_research where domain = $1`,
      [domain],
    );
    const r = rows[0];
    return r ? { ...r, researched_at: new Date(r.researched_at).toISOString(), expires_at: new Date(r.expires_at).toISOString() } : null;
  }

  async saveResearch(r: CachedResearch) {
    await this.pool.query(
      `insert into public.domain_research (domain, pages, facts, status, extractor, researched_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (domain) do update set pages = excluded.pages, facts = excluded.facts, status = excluded.status,
         extractor = excluded.extractor, researched_at = excluded.researched_at, expires_at = excluded.expires_at`,
      [r.domain, JSON.stringify(r.pages), JSON.stringify(r.facts), r.status, r.extractor, r.researched_at, r.expires_at],
    );
  }

  async saveGeneration(g: GenerationRecord) {
    await this.pool.query(
      `insert into public.generations (lead_id, workspace_id, plan, slot_outputs, full_email, subject, facts_used, skill_version,
         checks, judge_scores, research, provider, is_preview, attempts, step_no)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        g.lead_id, g.workspace_id, g.plan == null ? null : JSON.stringify(g.plan), JSON.stringify(g.slot_outputs), g.full_email, g.subject,
        g.facts_used, g.skill_version, JSON.stringify(g.checks), JSON.stringify(g.judge_scores), JSON.stringify(g.research), g.provider,
        g.is_preview, g.attempts, g.step_no ?? 1,
      ],
    );
  }

  async logCosts(leadId: string, workspaceId: string, costs: CostEntry[]) {
    for (const c of costs) {
      await this.pool.query(
        `insert into public.usage_costs (lead_id, workspace_id, step, model, input_tokens, output_tokens, cached_tokens, provider_units, cost_usd)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [leadId, workspaceId, c.step, c.model, c.input_tokens ?? 0, c.output_tokens ?? 0, c.cached_tokens ?? 0, c.provider_units ?? 0, c.cost_usd],
      );
    }
  }
}
