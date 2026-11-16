// Example outputs for /examples, grouped by industry. EVERY ENTRY BELOW IS A PLACEHOLDER: replace each
// one with a real output from a real campaign (with the lead's details changed or removed), then set
// placeholder: false. The page stays hidden until SHOW_PROOF=1, and placeholders are never shown in
// production (src/lib/proof.ts).

export type Example = {
  placeholder: boolean;
  industry: string;
  /** The company's website as shown (use a real one only with permission, otherwise anonymise). */
  site: string;
  /** What the sender sells, in one line. */
  sells: string;
  /** The personal line FirstLine wrote. */
  opener: string;
  /** The facts it used, each with the page it came from. */
  sources: { text: string; page: string }[];
  language: "en" | "nl";
};

const placeholder = (industry: string, i: number): Example => ({
  placeholder: true,
  industry,
  site: `placeholder-${i}.example`,
  sells: "PLACEHOLDER · what the sender sells",
  opener: "PLACEHOLDER · the opener FirstLine wrote for this lead goes here, word for word.",
  sources: [{ text: "PLACEHOLDER · the fact it used", page: "/page" }],
  language: "en",
});

export const EXAMPLE_INDUSTRIES = ["Bakeries and food", "Agencies", "SaaS", "Accountants", "Construction", "Recruitment"] as const;

export const EXAMPLES: Example[] = EXAMPLE_INDUSTRIES.flatMap((ind, i) => [placeholder(ind, i * 2 + 1), placeholder(ind, i * 2 + 2)]);

export const EXAMPLES_PAGE = {
  eyebrow: "Examples",
  title: "Real openers, with the facts behind them",
  intro: "Each line below was written by FirstLine for a real lead, from facts on the company's own website. Personal details are changed or removed.",
  industries: "Industries",
  sells: "sells",
  placeholder: "Placeholder: never shown in production",
  cta: { title: "See what it writes for your leads", sub: "25 free emails, no card, credits never expire.", cta: "Personalise 25 leads free" },
};
