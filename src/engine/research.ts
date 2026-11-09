// Website research (§5.1): robots -> map -> pick 3–4 pages -> scrape -> clean.
import { cleanMarkdown, hashText } from "./clean";
import type { EngineConfig } from "./config";
import { firecrawlCostEntry } from "./costs";
import type { WebReader } from "./firecrawl";
import { Semaphore } from "./limiter";
import { isAllowed, parseRobots } from "./robots";
import type { CostEntry, PickedPage, ResearchStatus, ScrapedPage } from "./types";
import { pickPages, urlLang } from "./urls";

export type ResearchResult = {
  status: ResearchStatus;
  picked: PickedPage[];
  pages: ScrapedPage[];
  costs: CostEntry[];
  notes: string[];
};

const MIN_CHARS = 150;

export async function researchDomain(
  domain: string,
  opts: { reader: WebReader; config: EngineConfig; lite?: boolean; gate?: Semaphore; website?: string | null },
): Promise<ResearchResult> {
  const { reader, config } = opts;
  const gate = opts.gate ?? new Semaphore(config.concurrency.firecrawl);
  const costs: CostEntry[] = [];
  const notes: string[] = [];
  const limit = opts.lite ? config.research.maxPagesLite : config.research.maxPages;

  const robotsText = await reader.robots(domain);
  const robots = robotsText ? parseRobots(robotsText) : null;
  const allowed = (url: string) => !robots || isAllowed(robots, config.research.userAgent, new URL(url).pathname);

  if (!allowed(`https://${domain}/`)) {
    return { status: "blocked", picked: [], pages: [], costs, notes: ["robots.txt disallows the homepage"] };
  }

  let links: string[] = [];
  try {
    const m = await gate.run(() => reader.map(`https://${domain}`));
    costs.push(firecrawlCostEntry("map", m.credits, config.firecrawlUsdPerCredit));
    links = m.links.map((l) => l.url);
  } catch (e) {
    notes.push(`map failed: ${(e as Error).message.slice(0, 120)}`);
  }

  const picked = pickPages(links, domain, limit, opts.website ? urlLang(opts.website) : null).filter((p) => {
    const ok = allowed(p.url);
    if (!ok) notes.push(`skipped by robots.txt: ${p.url}`);
    return ok;
  });

  let responded = false; // the site answered at least once (even with an empty page)
  const results = await Promise.all(
    picked.map((p) =>
      gate.run(async (): Promise<ScrapedPage | null> => {
        try {
          const r = await reader.scrape(p.url, config.research.pageTimeoutMs);
          costs.push(firecrawlCostEntry("scrape", r.credits, config.firecrawlUsdPerCredit));
          if (!r.statusCode || r.statusCode < 400) responded = true;
          if (r.statusCode && r.statusCode >= 400) {
            notes.push(`${p.url} returned ${r.statusCode}`);
            return null;
          }
          const markdown = cleanMarkdown(r.markdown, config.research.maxCharsPerPage);
          if (markdown.length < MIN_CHARS) {
            notes.push(`${p.url}: too little text`);
            return null;
          }
          return { ...p, markdown, md_hash: hashText(markdown), title: r.title };
        } catch (e) {
          notes.push(`${p.url}: ${(e as Error).message.slice(0, 120)}`);
          return null;
        }
      }),
    ),
  );

  const pages = results.filter((r): r is ScrapedPage => !!r);
  // Two URLs can serve the same page (redirects); keep the first.
  const unique = pages.filter((p, i) => pages.findIndex((q) => q.md_hash === p.md_hash) === i);
  const status: ResearchStatus = unique.length > 0 ? "ok" : responded ? "no_content" : "unreachable";
  return { status, picked, pages: unique, costs, notes };
}
