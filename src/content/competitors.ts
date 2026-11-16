// Competitor prices: the ONLY place they live. Every number was read on the tool's public pricing page
// on the date below; update both together. Prices are shown as the page shows them ("$", monthly
// billing where the page makes that clear). Wording on the site stays neutral.

export const COMPETITORS_CHECKED_ON = "2026-11-16";

export type Competitor = {
  id: string;
  name: string;
  source: string;
  /** One neutral sentence: what the tool is. */
  what: string;
  /** Cheapest plan that covers 300 AI-personalised emails a month (monthly price as shown), or null when the page doesn't say. */
  for300: { plan: string; price: number; currency: "$" | "€" } | null;
  /** Same for 10,000 a month. */
  for10k: { plan: string; price: number; currency: "$" | "€" } | null;
  /** What the numbers assume, and anything unclear on the page. */
  notes: string;
  /** Used in the homepage price anchor (only when the plan clearly includes AI personalisation for 300 emails). */
  inAnchor: boolean;
};

export const COMPETITORS: Competitor[] = [
  {
    id: "smartwriter",
    name: "Smartwriter",
    source: "https://www.smartwriter.ai/pricing",
    what: "AI personalisation tool for icebreakers, cold emails and LinkedIn messages, on credit-based monthly plans.",
    for300: { plan: "Basic (400 leads)", price: 59, currency: "$" },
    for10k: null,
    notes:
      "The page shows both $59 and $49 for Basic without clearly labelling which is monthly billing; we use the higher figure. The largest priced plan has 3,500 leads; higher tiers have no price on the page.",
    inAnchor: true,
  },
  {
    id: "lemlist",
    name: "Lemlist",
    source: "https://www.lemlist.com/pricing",
    what: "Multichannel outbound platform (email, LinkedIn, calls) with a lead database and AI features.",
    for300: { plan: "Email", price: 69, currency: "$" },
    for10k: { plan: "Email", price: 69, currency: "$" },
    notes:
      "The page shows $69 and $55 for the Email plan; $69 appears to be monthly billing, $55 yearly. AI is described as included in every paid plan and uses your own OpenAI account, so model costs come on top.",
    inAnchor: true,
  },
  {
    id: "instantly",
    name: "Instantly",
    source: "https://instantly.ai/pricing",
    what: "Cold-email sending and warm-up platform with a lead database and AI agents.",
    for300: { plan: "Starter bundle (with AI Email Writer)", price: 94, currency: "$" },
    for10k: { plan: "Scale bundle", price: 194, currency: "$" },
    notes:
      "A Growth credits plan at $47/month also lists the AI Email Writer, but the page doesn't say how many credits an AI email uses, so we use the Starter bundle. Yearly billing is lower ($85 and $175).",
    inAnchor: true,
  },
  {
    id: "clay",
    name: "Clay",
    source: "https://www.clay.com/pricing",
    what: "Data enrichment and workflow platform with AI research columns and email sequencing.",
    for300: { plan: "Launch", price: 167, currency: "$" },
    for10k: null,
    notes:
      "The Launch card says $167/mo while the FAQ says “starting at $185/mo”; we use $167. A free plan exists (500 actions, 200 rows per table). The data-credit cost of AI tasks isn't on the page, so 10,000 emails can't be priced from it.",
    inAnchor: true,
  },
  {
    id: "lyne",
    name: "Lyne.ai",
    source: "https://lyne.ai/pricing",
    what: "An installed AI email-drafting service that runs on your own cloud project and API key.",
    for300: null,
    for10k: null,
    notes: "No prices are published: setup and monthly fees are set after a diagnostic call.",
    inAnchor: false,
  },
];

/** The anchor range for 300 emails a month, from the competitors marked inAnchor. */
export function anchorRange300(list: Competitor[] = COMPETITORS) {
  const prices = list.filter((c) => c.inAnchor && c.for300).map((c) => c.for300!.price);
  return { min: Math.min(...prices), max: Math.max(...prices), currency: "$" as const, count: prices.length };
}

/** "16 Nov 2026" */
export function checkedOnLabel(date = COMPETITORS_CHECKED_ON, lang: "en" | "nl" = "en") {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(lang === "nl" ? "nl-NL" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
