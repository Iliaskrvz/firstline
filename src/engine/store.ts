// Storage the engine needs. Implemented by PgStore (worker) and MemoryStore (tests, CLI).
import type { CostEntry, Fact, LeadJob, PageType, ResearchStatus } from "./types";

export type CachedResearch = {
  domain: string;
  pages: { url: string; type: PageType; md_hash: string; title?: string }[];
  facts: Fact[];
  status: ResearchStatus;
  extractor: string;
  researched_at: string;
  expires_at: string;
};

export type GenerationRecord = {
  lead_id: string;
  workspace_id: string;
  plan: unknown | null;
  slot_outputs: Record<string, string>;
  full_email: string;
  subject: string;
  facts_used: string[];
  skill_version: string | null;
  checks: unknown;
  judge_scores: unknown;
  research: unknown;
  provider: string;
  is_preview: boolean;
  attempts: number;
  /** 1 = the first email (default); 2+ = a personalised follow-up. */
  step_no?: number;
};

export type LeadStatus = "queued" | "researching" | "writing" | "done" | "fallback" | "failed" | "skipped";

export interface EngineStore {
  loadLeadJob(leadId: string): Promise<LeadJob | null>;
  setLeadStatus(leadId: string, status: LeadStatus, opts?: { detail?: string | null; confidence?: "high" | "medium" | "low" | null }): Promise<void>;
  /** A cache row for the domain (any extractor); the engine decides if it may reuse it. */
  getCachedResearch(domain: string): Promise<CachedResearch | null>;
  saveResearch(r: CachedResearch): Promise<void>;
  saveGeneration(g: GenerationRecord): Promise<void>;
  logCosts(leadId: string, workspaceId: string, costs: CostEntry[]): Promise<void>;
  /**
   * Settle the lead's credit reservation (§3): capture `used`, release the rest.
   * No-op when the lead holds no reservation (preview, no website).
   */
  settleCredits(leadId: string, used: number): Promise<void>;
}

export class MemoryStore implements EngineStore {
  jobs = new Map<string, LeadJob>();
  statuses = new Map<string, { status: LeadStatus; detail?: string | null; confidence?: string | null }[]>();
  research = new Map<string, CachedResearch>();
  generations: GenerationRecord[] = [];
  settled: { leadId: string; used: number }[] = [];
  costs: (CostEntry & { lead_id: string })[] = [];

  async loadLeadJob(id: string) {
    const j = this.jobs.get(id);
    return j ? structuredClone(j) : null;
  }
  async setLeadStatus(id: string, status: LeadStatus, opts: { detail?: string | null; confidence?: "high" | "medium" | "low" | null } = {}) {
    const list = this.statuses.get(id) ?? [];
    list.push({ status, ...opts });
    this.statuses.set(id, list);
    const j = this.jobs.get(id);
    if (j) j.lead.status = status;
  }
  async getCachedResearch(domain: string) {
    return this.research.get(domain) ?? null;
  }
  async saveResearch(r: CachedResearch) {
    this.research.set(r.domain, r);
  }
  async saveGeneration(g: GenerationRecord) {
    this.generations.push(g);
  }  async settleCredits(leadId: string, used: number) {
    this.settled.push({ leadId, used });
  }

  async logCosts(leadId: string, _ws: string, costs: CostEntry[]) {
    this.costs.push(...costs.map((c) => ({ ...c, lead_id: leadId })));
  }
}
