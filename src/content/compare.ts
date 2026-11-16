// Copy for /compare and /compare/[tool]. Prices are NOT here: they live only in competitors.ts.
// Rules: neutral wording, only things their own public pages say (see `what` and `notes` in
// competitors.ts), and FirstLine's own limits stated as plainly as its strengths.

export const COMPARE = {
  eyebrow: "Compare",
  title: "FirstLine next to the tools you're looking at",
  intro:
    "Clay, Lemlist, Instantly, Lyne.ai and Smartwriter do more than personalise a line, and most of them charge per month. Here's what each one is, what their public pricing pages say for 300 and 10,000 emails a month, and where FirstLine fits.",
  tableTitle: "Cost for the same volume",
  tableNote:
    "Cheapest plan on each public pricing page that covers AI-personalised emails at that volume, monthly billing as shown, in the page's currency. FirstLine: the per-email price of the pack a year of that volume fills (credits never expire), excl. VAT.",
  columns: { tool: "Tool", what: "What it is", model: "How you pay", m300: "300 a month", m10k: "10,000 a month" },
  firstLine: {
    name: "FirstLine",
    what: "Reads each lead's own website and writes only the spots you mark in your own email, with a source for every line.",
    model: "Credit packs, no subscription. Credits never expire.",
  },
  models: {
    smartwriter: "Monthly plan, credit-based",
    lemlist: "Monthly plan",
    instantly: "Monthly plans; AI writer in bundles",
    clay: "Monthly plan with credits",
    lyne: "Setup fee plus monthly fee",
  } as Record<string, string>,
  unknown: { not_published: "Not on the pricing page", not_recorded: "See their pricing page", above_range: "See their pricing page" } as Record<"not_published" | "not_recorded" | "above_range", string>,
  rangeLabel: (low: string, high: string) => `${low}–${high}`,
  perMonth: "/month",
  rangePlans: (low: string, high: string) => `${low} to ${high}`,
  perEmailPack: (perEmail: string, pack: string) => `${perEmail} per email · ${pack} pack`,
  pricingLink: (name: string) => `${name} pricing`,
  calculatorLink: "Try your own volume in the calculator",
  emailsAMonth: "Emails a month",
  limitsTitle: "What FirstLine doesn't do",
  limitsIntro: "Better to know now than after you've bought credits.",
  limits: [
    "No lead database: you bring your own list (CSV, API, n8n or Make).",
    "No LinkedIn: research uses only the company's public website.",
    "No calls or LinkedIn steps: email only, from Gmail or your sending tool.",
    "No warm-up network: new inboxes start slowly instead.",
    "Not for high volume blasting: safe limits are built in on purpose.",
  ],
  togetherTitle: "Often used together",
  togetherText:
    "Many people keep their sending tool and add FirstLine for the research and the personal line: push finished emails to Instantly, Smartlead or Lemlist, or export a CSV.",
  perToolTitle: "One by one",
  readMore: (name: string) => `FirstLine vs ${name}`,
  sourcesTitle: "Sources",
  checkedOn: (date: string) => `Prices checked on ${date}. Prices change; follow the links for the current ones. Tell us if something here is out of date and we'll fix it.`,
  cta: { title: "See it on your own leads", sub: "25 free emails, no card, credits never expire.", cta: "Personalise 25 leads free" },

  /** /compare/[tool] */
  tool: {
    eyebrow: (name: string) => `FirstLine vs ${name}`,
    title: (name: string) => `FirstLine or ${name}?`,
    atAGlance: "At a glance",
    chooseThem: (name: string) => `${name} fits when`,
    chooseUs: "FirstLine fits when",
    together: "Using both",
    costTitle: "What it costs",
    notesTitle: "About these numbers",
    back: "All comparisons",
  },
};

/** Per tool: when it fits, when FirstLine fits, and how they work together. Neutral, from their own pages. */
export const COMPARE_TOOLS: Record<string, { chooseThem: string[]; chooseUs: string[]; together: string }> = {
  smartwriter: {
    chooseThem: [
      "You also want LinkedIn messages written, not only emails.",
      "You prefer a monthly plan with a set number of leads.",
    ],
    chooseUs: [
      "You want to keep your own email word for word and personalise only marked spots.",
      "You want to see the source of every line before you send.",
      "You send unevenly and prefer credits that never expire over a monthly plan.",
    ],
    together: "They do the same job, so most people pick one. Try both on the same 25 leads and compare the lines.",
  },
  lemlist: {
    chooseThem: [
      "You want one platform for email, LinkedIn steps and calls.",
      "You want a built-in lead database.",
    ],
    chooseUs: [
      "You only need the research and the personal line, not a full outbound platform.",
      "You don't want to connect your own OpenAI account and pay its model costs on top.",
      "You want a source for every personal line.",
    ],
    together: "Write the personal lines in FirstLine, then push the finished emails to Lemlist and keep sending from there.",
  },
  instantly: {
    chooseThem: [
      "You want sending and inbox warm-up in the same tool.",
      "You want sending, a lead database and AI agents in one subscription.",
    ],
    chooseUs: [
      "You want each line based on the lead's own website, with its source shown.",
      "You send a few hundred emails a month and don't want a monthly bundle for that.",
      "You're happy sending from your own Gmail at a careful pace.",
    ],
    together: "Keep Instantly for sending. FirstLine writes the personal lines and pushes the finished emails to your Instantly campaign.",
  },
  clay: {
    chooseThem: [
      "You build data enrichment workflows with AI research columns.",
      "You want spreadsheets of researched data, not only email lines.",
    ],
    chooseUs: [
      "You want finished emails without building a workflow.",
      "You want a fixed price per email instead of credits per action.",
      "You want built-in checks that reject generic or unsupported lines.",
    ],
    together: "Find and enrich leads in Clay, export them as a CSV, and let FirstLine write the personal lines in your email.",
  },
  lyne: {
    chooseThem: [
      "You want a done-for-you setup in your own cloud project.",
      "You prefer a set-up service with a call first.",
    ],
    chooseUs: [
      "You want to start today without a call or setup fee.",
      "You want public, per-email prices.",
    ],
    together: "They solve the same problem in different ways, so most people pick one.",
  },
};
