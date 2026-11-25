// Three sample Outlook drafts (and the full ZIP) for checking in real Outlook versions, written by the
// fake AI provider (no network, no keys):
//   npx tsx scripts/outlook-samples.ts   → outlook-samples/ (git-ignored)
import { mkdirSync, writeFileSync } from "node:fs";
import { engineConfig } from "../src/engine/config";
import { runDemo } from "../src/engine/demo";
import type { WebReader } from "../src/engine/firecrawl";
import { FakeLLM } from "../src/engine/llm-fake";
import { MemoryStore } from "../src/engine/store";
import { buildEml, buildOutlookZip, type OutlookLead } from "../src/lib/outlook-export";
import { composeBody, defaultOptOutLine } from "../src/lib/sender/messages";

const site = (news: string): WebReader => ({
  robots: async () => null,
  map: async (url) => ({ links: [{ url: `${new URL(url).origin}/` }, { url: `${new URL(url).origin}/news` }], credits: 0 }),
  scrape: async (url) => ({ markdown: new URL(url).pathname === "/" ? "# Welcome\n\nWe have baked bread by hand since 1987, every morning in our own oven." : `# News\n\n${news}`, statusCode: 200, credits: 0 }),
});

async function opener(domain: string, news: string, lang: "en" | "nl"): Promise<string> {
  const r = await runDemo({ domain, lang }, { store: new MemoryStore(), reader: site(news), llm: new FakeLLM(), config: engineConfig({}) });
  if (r.status !== "done") throw new Error(`fake provider gave ${r.status} for ${domain}`);
  return r.opener;
}

async function main() {
  const en = await opener("bakkerijvos.nl", "We opened a second shop in Utrecht-Oost this spring to be closer to our customers in the east of the city. The team grew to twelve bakers this year.", "en");
  const nl = await opener("cafeoresund.nl", "We opened a breakfast terrace this autumn so guests can start the day by the water. The team grew to eight people this year, with two new baristas from Malmö. Our new menu uses bread from local bakers and coffee roasted in the city.", "nl");
  const leads: OutlookLead[] = [
    {
      first: {
        to: "sanne@example.com", firstName: "Sanne", lastName: "de Vos", company: "Bakkerij Vos",
        subject: "Quick question about Utrecht-Oost",
        text: composeBody(`Hi Sanne,\n\n${en}\n\nWe help bakeries cut waste with daily order forecasts. Worth a quick call next week?\n\nTom`, defaultOptOutLine("en")),
      },
      followUps: [
        {
          step: 2,
          draft: {
            to: "sanne@example.com", firstName: "Sanne", lastName: "de Vos", company: "Bakkerij Vos",
            subject: "Quick question about Utrecht-Oost",
            text: composeBody("Hi Sanne,\n\nJust bringing this back to the top of your inbox. Would a 15-minute call next week work?\n\nTom", defaultOptOutLine("en")),
          },
        },
      ],
    },
    {
      first: {
        to: "zoe@example.com", firstName: "Zoë", lastName: "Müller-Ødegård", company: "Café Øresund",
        subject: "Vraagje over jullie ontbijt – één idee",
        text: composeBody(`Hoi Zoë,\n\n${nl}\n\nWij helpen horeca met slimme inkoop. Zin in een kort gesprek? 🙂\n\nTom`, defaultOptOutLine("nl")),
      },
      followUps: [],
    },
  ];
  mkdirSync("outlook-samples", { recursive: true });
  writeFileSync("outlook-samples/1-simple-english.eml", buildEml(leads[0].first));
  writeFileSync("outlook-samples/2-accents-dutch.eml", buildEml(leads[1].first));
  writeFileSync("outlook-samples/3-follow-up-step-2.eml", buildEml(leads[0].followUps[0].draft));
  writeFileSync("outlook-samples/sample-outlook-drafts.zip", buildOutlookZip({ campaign: "Sample campaign", leads, mailMerge: true }));
  console.log("Wrote outlook-samples/: 3 .eml files and sample-outlook-drafts.zip (example.com addresses only).");
}

main();
