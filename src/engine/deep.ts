// Deep research (Phase 11), behind a switch that is OFF (config.deep.enabled): find at most 2 facts
// about the contact's OWN professional content tied to their CURRENT company (articles they wrote,
// talks, podcast appearances, company news naming them), only to write that one email.
//
// Narrow by design (owner's decisions, 2026-11-12):
// - one web search (Firecrawl) for "first last" + company, never LinkedIn or people-search sites;
// - read at most 2 pages, and only pages whose title/snippet name the person;
// - code checks the page names the person AND the company before the AI sees it; the AI must say
//   "yes, same person", else nothing is used and nothing is charged ("no confident match");
// - facts touching personal life are dropped; at most 2 facts, each with its source URL;
// - the caller never runs this for suppressed contacts, never puts the facts in the shared domain
//   cache, and stores them only with the lead (deleted with it).
import { touchesForbiddenTopic } from "./checks";
import type { EngineConfig } from "./config";
import { firecrawlCostEntry } from "./costs";
import type { WebReader } from "./firecrawl";
import type { Gate } from "./limiter";
import { LLMRefusalError, type LLM } from "./llm";
import { PERSON_KINDS } from "./schemas";
import type { CostEntry, Fact } from "./types";

export type DeepStatus = "matched" | "no_match" | "not_searched";
export type DeepResult = { status: DeepStatus; detail: string; facts: Fact[]; costs: CostEntry[] };

/** Never searched or read for person facts. */
const BLOCKED_HOSTS = [
  "linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "threads.net", "pinterest.com",
  "spokeo.com", "pipl.com", "whitepages.com", "rocketreach.co", "zoominfo.com", "apollo.io", "lusha.com", "contactout.com",
  "signalhire.com", "theorg.com", "crunchbase.com", "peoplefinders.com", "radaris.com", "beenverified.com", "truepeoplesearch.com",
];

export type DeepPerson = { first_name: string | null; last_name: string | null; company: string | null; domain: string | null; title: string | null };

const norm = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function blockedHost(url: string): boolean {
  const h = hostOf(url);
  return !h || BLOCKED_HOSTS.some((b) => h === b || h.endsWith(`.${b}`));
}

/** The page names the person (first + last) and ties them to the company (name or website). */
export function pageMatches(text: string, p: { first: string; last: string; company: string | null; domain: string }): boolean {
  const t = norm(text);
  const full = norm(`${p.first} ${p.last}`);
  if (!t.includes(full)) return false;
  // "Acme Studio B.V." → "acme studio": legal suffixes are often left out on other sites.
  const company = p.company ? norm(p.company).replace(/[\s,]+(b\.?\s?v\.?|n\.?\s?v\.?|gmbh|ltd\.?|inc\.?|llc|vof|v\.o\.f\.)$/, "").replace(/[.,]+$/, "").trim() : "";
  return (company.length >= 3 && t.includes(company)) || t.includes(p.domain.toLowerCase());
}

export async function findPersonFacts(
  person: DeepPerson,
  deps: { reader: WebReader; llm: LLM; config: EngineConfig; gate?: Gate },
): Promise<DeepResult> {
  const { reader, llm, config } = deps;
  const costs: CostEntry[] = [];
  const none = (status: DeepStatus, detail: string): DeepResult => ({ status, detail, facts: [], costs });
  const first = person.first_name?.trim();
  const last = person.last_name?.trim();
  const domain = person.domain?.trim().toLowerCase();
  if (!first || !last || !domain) return none("not_searched", "Deep needs the contact's first and last name and company website");
  if (!reader.search || !llm.personFacts) return none("not_searched", "Deep research isn't available");
  const gate = deps.gate ?? { run: <T>(fn: () => Promise<T>) => fn() };

  // 1. One search: the person's full name with their company.
  const query = `"${first} ${last}" "${person.company?.trim() || domain}" -site:linkedin.com`;
  const found = await gate.run(() => reader.search!(query, config.deep.searchResults));
  costs.push(firecrawlCostEntry("search", found.credits, config.firecrawlUsdPerCredit));

  // 2. Only results whose title or snippet name the person, never social or people-search sites.
  const lastN = norm(last);
  const candidates = found.results
    .filter((r) => !blockedHost(r.url) && norm(`${r.title} ${r.description}`).includes(lastN))
    .slice(0, config.deep.pagesToRead);
  if (!candidates.length) return none("no_match", "No confident match: no public page names this person");

  // 3. Read them; keep pages that name the person and the company.
  const pages: { url: string; markdown: string }[] = [];
  for (const c of candidates) {
    try {
      const s = await gate.run(() => reader.scrape(c.url, 15_000));
      costs.push(firecrawlCostEntry("scrape", s.credits, config.firecrawlUsdPerCredit));
      if (s.markdown && pageMatches(s.markdown, { first, last, company: person.company, domain })) pages.push({ url: c.url, markdown: s.markdown });
    } catch {
      /* unreadable page: skip it */
    }
  }
  if (!pages.length) return none("no_match", "No confident match: no page ties this person to the company");

  // 4. The AI decides if it's the same person and picks at most 2 facts about their own work.
  let out;
  try {
    const r = await llm.personFacts({ person: { first_name: first, last_name: last, company: person.company, domain, title: person.title }, pages });
    costs.push(...r.costs);
    out = r.output;
  } catch (e) {
    if (e instanceof LLMRefusalError) return none("no_match", "No confident match");
    throw e;
  }
  if (out.same_person !== "yes") return none("no_match", "No confident match");

  // 5. Code checks on what the AI returned: source is one of the pages read, an allowed kind, no personal life.
  const read = new Set(pages.map((p) => p.url));
  const facts: Fact[] = out.facts
    .filter((f) => read.has(f.src) && (PERSON_KINDS as readonly string[]).includes(f.kind) && f.text.trim().length > 0 && !touchesForbiddenTopic(f.text))
    .slice(0, config.deep.maxFacts)
    .map((f, i) => ({ id: `P${i + 1}`, text: f.text.trim(), src: f.src, tier: "D" as const }));
  if (!facts.length) return none("no_match", "No confident match: nothing usable about their own work");
  return { status: "matched", detail: `${facts.length} fact${facts.length > 1 ? "s" : ""} from their own published work`, facts, costs };
}
