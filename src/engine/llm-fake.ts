// Fake LLM for building and testing without Claude. Output is realistic and
// grounded in the real page text, but it is NOT AI writing: the UI labels it
// "Test output, no AI used". Costs $0.
import type { BatchWriter, CompareOutput, ExtractInput, FactCheckInput, LLM, LLMResult, PersonInput, WriteInput } from "./llm";
import type { FactCheckOutput, PersonFactsOutput } from "./schemas";
import type { Fact, JudgeScores, Language, WriterOutput } from "./types";
import { countWords } from "@/lib/template";

const SENTENCE = /[^.!?\n]+[.!?]/g;
const SIGNAL = /\b(since|founded|opgericht|sinds|seit|gegründet|new|nieuwe?|neu\w*|launch\w*|opened|geopend|team|clients?|klanten|kunden|specialis\w*|gespecialiseerd|award|project|vestiging|location|office|kantoor|expanded|uitgebreid|partner\w*|certif\w*)\b/i;
const TYPE_WEIGHT: Record<string, number> = { news: 3, about: 2, services: 1, careers: 1, home: 0 };

function thirdPerson(s: string, company: string | null, lang: Language): string {
  const name = company ?? (lang === "nl" ? "Het bedrijf" : lang === "de" ? "Das Unternehmen" : "The company");
  return s
    .replace(/^(we|wij|wir)\b/i, name)
    .replace(/\b(our|onze|ons|unser\w*)\b/gi, lang === "nl" ? "hun" : lang === "de" ? "ihr" : "their")
    .replace(/\b(we|wij|wir)\b/gi, lang === "nl" ? "ze" : lang === "de" ? "sie" : "they");
}

function guessLanguage(text: string): Language {
  const t = ` ${text.toLowerCase()} `;
  const nl = (t.match(/ (de|het|een|en|van|voor|met|wij|onze) /g) ?? []).length;
  const de = (t.match(/ (der|die|das|und|mit|für|wir|unser) /g) ?? []).length;
  const en = (t.match(/ (the|and|with|for|our|we|to) /g) ?? []).length;
  return nl > de && nl > en ? "nl" : de > en ? "de" : "en";
}

export class FakeLLM implements LLM {
  readonly provider = "fake" as const;
  readonly extractorId = "fake";

  async extractFacts(input: ExtractInput): Promise<LLMResult<{ facts: Fact[] }>> {
    const lang = guessLanguage(input.pages.map((p) => p.markdown).join(" "));
    const candidates = input.pages.flatMap((p) =>
      (p.markdown.replace(/^#+\s.*$/gm, "").match(SENTENCE) ?? [])
        .map((s) => s.trim().replace(/\s+/g, " ").replace(/^([-*•>]|\d+[.)])\s+/, "").replace(/[*_\\]+|\p{Extended_Pictographic}/gu, "").replace(/^[«"“\s]+/, "").trim())
        .filter((s) => {
          const w = countWords(s);
          return w >= 7 && w <= 24 && !/[@|]|cookie|©|\[removed/i.test(s);
        })
        .map((s) => ({ s, url: p.url, score: (TYPE_WEIGHT[p.type] ?? 0) + (SIGNAL.test(s) ? 3 : 0) + (/\d/.test(s) ? 1 : 0) })),
    );
    const seen = new Set<string>();
    const facts = candidates
      .sort((a, b) => b.score - a.score)
      .filter((c) => !seen.has(c.s.toLowerCase()) && !!seen.add(c.s.toLowerCase()))
      .slice(0, 5)
      .map((c, i) => ({ id: `F${i + 1}`, text: thirdPerson(c.s, input.company, lang), src: c.url, tier: "A" as const }));
    return { output: { facts }, costs: [] };
  }

  async write(input: WriteInput): Promise<LLMResult<WriterOutput>> {
    const websiteFacts = input.facts.filter((f) => f.tier === "A");
    // A follow-up uses a different fact than the first email, when there is one.
    const pick = input.followUp ? input.followUp.stepNo - 1 : 0;
    // Deep (tests): the first email uses the contact's own published work when there is a fact about it.
    const personFact = input.followUp ? undefined : input.facts.find((f) => f.tier === "D");
    const angle = personFact ?? (websiteFacts.length ? websiteFacts[pick % websiteFacts.length] : input.facts[0]);
    const lang = input.language;
    const slots: Record<string, string> = {};
    input.template.slots.forEach((slot, i) => {
      if (i === 0 && angle) {
        const lead = personFact
          ? { en: "Saw your work:", nl: "Zag je werk:", de: "Habe Ihre Arbeit gesehen:", fr: "J'ai vu votre travail :" }[lang]
          : { en: "Read on your site that", nl: "Las op jullie site dat", de: "Habe auf Ihrer Website gelesen, dass", fr: "J'ai lu sur votre site que" }[lang];
        const room = Math.max(4, slot.max_words - countWords(lead));
        const fact = angle.text.replace(/[.!?]+$/, "").split(/\s+/).slice(0, room).join(" ");
        slots[slot.key] = `${lead} ${fact.charAt(0).toLowerCase()}${fact.slice(1)}.`;
      } else {
        const line = {
          en: "If that keeps your team busy, this could take some work off your plate.",
          nl: "Als dat jullie team druk houdt, kan dit wat werk uit handen nemen.",
          de: "Wenn das Ihr Team auslastet, könnte das Ihnen etwas Arbeit abnehmen.",
          fr: "Si cela occupe votre équipe, cela pourrait vous faire gagner du temps.",
        }[lang];
        slots[slot.key] = line.split(/\s+/).slice(0, slot.max_words).join(" ");
      }
    });
    return {
      output: {
        plan: { angle: angle?.id ?? "F1", pain: "test output: pain not analysed", move: ["genuine_interest"], cta_type: "soft_question" },
        slots,
        facts_used: angle ? [angle.id] : [],
        skill_version: input.skillVersion,
      },
      costs: [],
    };
  }

  /** Quality Lab stand-in: no opinion, so identical or different outputs both tie. */
  /** Test stand-in: "yes" when a page names the person and their company, facts from sentences naming them. */
  async personFacts(input: PersonInput): Promise<LLMResult<PersonFactsOutput>> {
    const p = input.person;
    const full = `${p.first_name} ${p.last_name}`.toLowerCase();
    const company = (p.company ?? "").toLowerCase();
    const facts: PersonFactsOutput["facts"] = [];
    let named = false;
    let tied = false;
    for (const page of input.pages) {
      const text = page.markdown.replace(/^#+\s.*$/gm, "").replace(/\s+/g, " ").trim();
      const lower = text.toLowerCase();
      if (!lower.includes(full)) continue;
      named = true;
      if ((company && lower.includes(company)) || lower.includes(p.domain)) tied = true;
      const sentence = text.split(/(?<=[.!?])\s+/).find((s) => s.toLowerCase().includes(p.last_name.toLowerCase()) && s.split(" ").length >= 6);
      if (sentence && facts.length < 2) {
        const kind = /podcast|interview/i.test(sentence) ? "podcast" : /talk|keynote|spreker|webinar|panel/i.test(sentence) ? "talk" : /wrote|schreef|article|artikel|blog/i.test(sentence) ? "article" : "company_news";
        facts.push({ text: sentence.slice(0, 200), src: page.url, kind, date: null });
      }
    }
    const verdict = named && tied ? "yes" : named ? "unsure" : "no";
    return { output: { same_person: verdict, reason: `fake: named=${named} tied=${tied}`, facts: verdict === "yes" ? facts : [] }, costs: [] };
  }

  async compare(): Promise<LLMResult<CompareOutput>> {
    return { output: { winner: "tie", reason: "Test output, no AI used" }, costs: [] };
  }

  /** Bake-off stand-in: a fact counts as supported when its first words are on the page it cites. */
  async checkFacts(input: FactCheckInput): Promise<LLMResult<FactCheckOutput>> {
    const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ");
    return {
      output: {
        checks: input.facts.map((f) => {
          const page = input.pages.find((p) => p.url === f.src);
          const head = norm(f.text).split(" ").slice(1, 5).join(" ");
          return { id: f.id, verdict: page && norm(page.markdown).includes(head) ? ("supported" as const) : ("unsupported" as const), note: "Test output, no AI used" };
        }),
      },
      costs: [],
    };
  }

  /**
   * Economy stand-in: a "batch" that is ready after FAKE_BATCH_DELAY_S seconds (default 30) and
   * answers with the same test output as a direct write. Stateless, so it survives a worker restart.
   */
  readonly batch: BatchWriter = {
    submit: async () => `fake-${Date.now()}`,
    status: async (batchId) => {
      const started = Number(batchId.replace("fake-", ""));
      const delayMs = Number(process.env.FAKE_BATCH_DELAY_S ?? 30) * 1000;
      return Date.now() - started >= delayMs ? "ended" : "in_progress";
    },
    results: async (_batchId, items) => Promise.all(items.map(async (it) => ({ id: it.id, ...(await this.write(it.input)) }))),
  };

  async judge(): Promise<LLMResult<JudgeScores>> {
    return {
      output: { relevance: 4, specificity: 4, value_clarity: 4, cta_effort: 4, sounds_human: 4, would_reply: 4, claims_supported: true, unsupported_claims: [] },
      costs: [],
    };
  }
}
