// Run the real pipeline on a CSV without the database:
//   npm run engine:try -- fixtures/sample-leads.csv [--limit 5] [--json out.json]
// Real Firecrawl research; the writer is whatever LLM_PROVIDER says (default: fake).
// Max 5 leads per run to keep spend low.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", override: true, quiet: true });

import { readFileSync, writeFileSync } from "node:fs";
import { analyseColumns, applyMapping, decodeCsvBytes, parseCsv } from "@/lib/csv";
import { parseTemplate } from "@/lib/template";
import { assertEnv } from "@/lib/env";
import { engineConfig } from "@/engine/config";
import { createFirecrawl } from "@/engine/firecrawl";
import { selectLLM } from "@/engine/llm";
import { processLead } from "@/engine/pipeline";
import { MemoryStore } from "@/engine/store";
import type { LeadJob } from "@/engine/types";

const TEMPLATE_NL = {
  subject: "Idee voor {{company}}",
  body: `Hoi {{first_name}},

[[opener · iets specifieks over hun bedrijf, van hun website · 25]]

Wij helpen bedrijven zoals {{company}} met het automatiseren van terugkerend administratief werk. [[bridge · één zin die hun situatie koppelt aan minder handwerk · 25]]

Is dit iets om eens naar te kijken?

Groet,
Ilias`,
};

type ResearchView = {
  status?: string;
  picked?: { url: string; type: string }[];
  pages?: { url: string; type: string }[];
  facts?: { id: string; tier: string; text: string; src: string }[];
  notes?: string[];
  ai?: string;
};

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a)) ?? "fixtures/sample-leads.csv";
  const limitArg = args.indexOf("--limit");
  const limit = Math.min(5, limitArg >= 0 ? Number(args[limitArg + 1]) || 5 : 5);
  const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;

  assertEnv(["firecrawl"]);
  const config = engineConfig();
  const llm = await selectLLM(config);
  const reader = createFirecrawl(config.firecrawlApiKey!);
  const store = new MemoryStore();

  const csv = parseCsv(decodeCsvBytes(readFileSync(file)).text);
  const { map } = analyseColumns(csv.headers, csv.rows);
  const { leads } = applyMapping(csv.rows, map, csv.rowNumbers);
  const tpl = parseTemplate(TEMPLATE_NL);

  console.log(
    `\nFirstLine engine test · ${file} · ${Math.min(limit, leads.length)} of ${leads.length} leads · LLM: ${llm.provider}${llm.provider === "fake" ? " (test output, no AI used)" : ""}\n`,
  );
  const report = [];
  for (const [i, l] of leads.slice(0, limit).entries()) {
    const job: LeadJob = {
      lead: { id: `lead-${i + 1}`, workspace_id: "cli", campaign_id: "cli", status: "queued", ...l },
      campaign: { id: "cli", writer: "pro", depth: { deep: false } },
      template: { id: "cli", ...TEMPLATE_NL, slots: tpl.slots, style_rules: { language: "auto" }, examples: [] },
    };
    store.jobs.set(job.lead.id, job);
    const started = Date.now();
    const res = await processLead(job.lead.id, { store, reader, llm, config }, { preview: true });
    const g = store.generations.findLast((x) => x.lead_id === job.lead.id);
    const r = (g?.research ?? {}) as ResearchView;
    const checks = (g?.checks ?? {}) as { items?: { label: string; pass: boolean; detail?: string }[] };
    const costs = store.costs.filter((c) => c.lead_id === job.lead.id);

    console.log("─".repeat(78));
    console.log(`${i + 1}. ${l.first_name ?? ""} ${l.last_name ?? ""} · ${l.company ?? "?"} · ${l.domain ?? "no website"}`);
    console.log(`   Result: ${res.outcome.toUpperCase()}${res.detail ? ` (${res.detail})` : ""} · ${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log(`   Research: ${r.status ?? "-"}`);
    console.log("   Pages picked:");
    for (const p of r.picked ?? r.pages ?? []) {
      const ok = (r.pages ?? []).some((q) => q.url === p.url);
      console.log(`     ${ok ? "✓" : "✗"} ${p.type.padEnd(8)} ${p.url}`);
    }
    for (const n of r.notes ?? []) console.log(`     note: ${n}`);
    console.log("   Facts:");
    for (const f of r.facts ?? []) console.log(`     ${f.id} [tier ${f.tier}] ${f.text}\n        source: ${f.src}`);
    if (!r.facts?.length) console.log("     (none)");
    if (g?.plan) console.log(`   Plan: ${JSON.stringify(g.plan)}`);
    console.log("   Slots:");
    for (const [k, v] of Object.entries(g?.slot_outputs ?? {})) console.log(`     ${k}: ${v || "(left out)"}`);
    console.log(`   Facts used: ${g?.facts_used?.join(", ") || "-"}`);
    if (checks.items?.length) {
      console.log("   Checks:");
      for (const c of checks.items) console.log(`     ${c.pass ? "✓" : "✗"} ${c.label}${c.detail ? ` (${c.detail})` : ""}`);
    }
    console.log(
      `   Cost: $${res.costUsd.toFixed(5)}  (${costs.map((c) => `${c.model}${c.provider_units ? ` ×${c.provider_units}` : ""}`).join(", ") || "no paid calls"})`,
    );
    if (g?.full_email) {
      console.log(`\n   ── Email ──\n   Subject: ${g.subject}`);
      console.log(g.full_email.split("\n").map((x) => `   ${x}`).join("\n") + "\n");
    }
    report.push({ lead: l, result: res, generation: g, costs });
  }
  const total = store.costs.reduce((s, c) => s + c.cost_usd, 0);
  const credits = store.costs.reduce((s, c) => s + (c.provider_units ?? 0), 0);
  console.log("─".repeat(78));
  console.log(`Total real cost: $${total.toFixed(5)} · Firecrawl credits: ${credits}`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
