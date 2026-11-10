// Fake LLM for building and testing without Claude. Output is realistic and
// grounded in the real page text, but it is NOT AI writing: the UI labels it
// "Test output, no AI used". Costs $0.
import type { BatchWriter, CompareOutput, ExtractInput, LLM, LLMResult, WriteInput } from "./llm";
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
    const angle = websiteFacts.length ? websiteFacts[pick % websiteFacts.length] : input.facts[0];
    const lang = input.language;
    const slots: Record<string, string> = {};
    input.template.slots.forEach((slot, i) => {
      if (i === 0 && angle) {
        const lead = { en: "Read on your site that", nl: "Las op jullie site dat", de: "Habe auf Ihrer Website gelesen, dass", fr: "J'ai lu sur votre site que" }[lang];
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
  async compare(): Promise<LLMResult<CompareOutput>> {
    return { output: { winner: "tie", reason: "Test output, no AI used" }, costs: [] };
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
