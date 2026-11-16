// Homepage copy (English). Components read from here; no marketing copy in the page itself.
// Voice: calm, factual, direct. No exclamation marks, no hype words. Dutch version: batch 4 (/nl).
// Numbers must stay true: prices from src/config/packs.ts, sending limits from src/lib/sender/schedule.ts,
// competitor prices from src/content/competitors.ts.
import { anchorRange300, checkedOnLabel } from "./competitors";

const range = anchorRange300();

export const HOME = {
  meta: {
    title: "FirstLine: researched cold email openers, from €0.03 per email",
    description:
      "Upload your leads, paste your own cold email. FirstLine reads each company's website and writes only the personal lines, each with its source. From €0.03 per email, no subscription.",
    ogTitle: "Cold emails that sound like you researched every lead",
    ogDescription: "Your own copy, researched per lead, with a source for every line. From €0.03 per email, no subscription, sent free from your Gmail.",
  },

  nav: { cta: "Personalise 25 leads free", api: "For developers / API" },

  hero: {
    /** Chosen: outcome first, then price with "from" (Agency is €0.030; Starter €0.038). */
    headline: "Cold emails that sound like you researched every lead.",
    headlineMuted: "From €0.03 each, no subscription.",
    sub: "For founders and small B2B teams who write their own cold emails. Upload your leads, paste your email, and see your first researched emails in about 10 minutes.",
    cta: "Personalise 25 leads free",
    secondary: "See pricing",
    note: "25 free emails after you confirm your address. No card.",
    footnote: "Every personal line cites the page it came from.",
    /** The three options shown to the owner in batch 1. */
    options: [
      { text: "Cold emails that sound like you researched every lead. From €0.03 each, no subscription.", why: "Outcome first, then price. \"From\" keeps it true: €0.030 is the Agency rate." },
      { text: "Your own cold email, researched per lead, with a source for every line. From €0.03.", why: "Leads with the differentiators (your copy, sources). Less emotional pull." },
      { text: "Stop sending openers nobody reads. Researched first lines from €0.03 per email.", why: "Pain first, strong hook. Slightly more negative than the brand voice." },
    ],
  },

  problem: {
    eyebrow: "The problem",
    title: "Why most cold emails go unanswered",
    items: [
      {
        title: "Generic AI openers get ignored",
        text: "“I came across your company and was impressed…” Your prospects read that line every day. They can tell nobody looked.",
      },
      {
        title: "Real research takes time you don't have",
        text: "Five minutes on each company's website is 25 hours for 300 leads. Most people stop after ten.",
      },
      {
        title: "The tools that do it charge every month",
        text: `Tools with AI personalisation charge ${range.currency}${range.min}–${range.max} a month for a plan that covers 300 emails, whether you send them or not.`,
      },
    ],
  },

  /** The animated example in the hero (a made-up bakery; mirrors what the preview shows). */
  demo: {
    url: "bakkerijvos.nl/nieuws",
    pageTitle: "Nieuws",
    before: "Ambachtelijk brood sinds 1987, elke ochtend vers uit eigen oven.",
    fact: "Vanaf 1 maart ook open in Utrecht-Oost.",
    after: "Kom langs voor een gratis proeverij in de eerste week.",
    factId: "F2",
    emailLabel: "Your email, personalised",
    greeting: "Hi Sanne,",
    opener: "Saw that Bakkerij Vos just opened a second shop in Utrecht-Oost, congrats.",
    rest: "We help bakeries cut waste with daily order forecasts. Worth a quick call next week?",
    source: "bakkerijvos.nl/nieuws",
  },

  integrations: { label: "Send or export to", names: ["Gmail", "Instantly", "Smartlead", "Lemlist", "n8n", "Make", "CSV"] },

  preview: {
    title: "This is the free preview",
    text: "Before a campaign runs, you see 5 leads like this: every fact with its page, the email with the personal line marked, and the checks it passed.",
  },

  how: {
    eyebrow: "How it works",
    title: "Your email. Their website. One good line.",
    steps: [
      { time: "About 1 minute", title: "Upload your leads", text: "A CSV with names, companies and websites. We clean the domains and remove duplicates." },
      { time: "About 2 minutes", title: "Paste your own email", text: "Mark the spots to personalise, like [[opener]]. Everything else stays word for word." },
      { time: "5 leads free, in minutes", title: "We read each website", text: "FirstLine finds real facts on the company's own site and writes only your marked spots. Check the free preview before anything runs." },
      { time: "Up to 30 a day per inbox", title: "Send or export", text: "Send from your own Gmail with safe limits and follow-ups, or push the results to your sending tool." },
    ],
  },

  trust: {
    eyebrow: "Built to be trusted",
    title: "No made-up facts. Every line shows where it came from.",
    body: "Code checks and an AI reviewer look at every line before you see it. Generic, salesy or unsupported lines get rewritten. If a website has nothing useful, the lead gets a neutral line and costs nothing.",
    points: ["Every claim links to its page", "Your offer and tone are never rewritten", "No facts found, no charge"],
  },

  api: {
    eyebrow: "API, n8n and Make",
    title: "Plug first lines into your own flow",
    body: "Send a lead, get back a personal line with its sources. Same credits, same checks. Use the REST API, our n8n node or the Make app.",
    cta: "Read the API docs",
  },

  pricing: {
    eyebrow: "Pricing",
    title: "Pay per email. Nothing else.",
    sub: "Credits never expire. Only finished emails use a credit. Sending from Gmail and plain follow-ups are free.",
    anchor: "300 emails ≈ €10 in credits.",
    compare: {
      elsewhere: `Same 300 emails with a personalisation tool elsewhere: ${range.currency}${range.min}–${range.max} a month.`,
      us: "With FirstLine: about €10 in credits, once. No subscription.",
      sourcesLabel: `Sources, checked ${checkedOnLabel()}`,
      sourcesNote:
        "Cheapest plan on each public pricing page that covers 300 AI-personalised emails a month, monthly billing as shown (some pages show a lower yearly price). Prices in the currency the page shows.",
    },
    perEmail: "per email",
    packLine: (credits: string, price: string) => `${price} for ${credits} emails`,
    save: (pct: number) => `Save ${pct}%`,
    anchorNote: "The smallest pack is 500 credits for €19.",
    buy: (credits: string) => `Buy ${credits} credits`,
    mostPopular: "Most popular",
    perPack: "excl. VAT · one-time",
    footnote: "Leads where the website has nothing useful get a neutral line and use no credit. Economy mode (results within hours) and extra research options are available inside the app.",
  },

  faq: {
    eyebrow: "FAQ",
    title: "Questions",
    items: [
      { q: "Do I need a subscription?", a: "No. Buy credits when you need them; they never expire. 1 credit = 1 personalised email." },
      { q: "Can I try it first?", a: "Yes. You get 25 free credits after confirming your email, and every campaign starts with a free preview of 5 leads." },
      {
        q: "How does sending from Gmail work?",
        a: "You copy a Google Sheet with a small script into your own Google account. It sends from your inbox at a safe pace and stops a sequence when someone replies. We never get your password.",
      },
      { q: "Does FirstLine scrape LinkedIn?", a: "No. Research uses only the company's public website. Names and job titles come from your own list." },
      { q: "Which languages?", a: "English and Dutch, picked automatically from the language of your email." },
      {
        q: "Will my Gmail get blocked?",
        a: "Nobody can promise that, but FirstLine sends carefully. A new inbox starts at 10 emails a day and adds 2 a day up to 30. Emails go out 6 to 14 minutes apart, on weekdays during office hours, and sending slows down when bounces go above 3%. We recommend a separate domain for outreach.",
      },
      {
        q: "Can I edit emails before sending?",
        a: "You see a free preview of 5 leads first, with every fact and its source. If a line isn't right, change your email or the instruction for that spot and run the preview again. Editing single emails is possible after export, in the CSV or your sending tool; editing them one by one inside FirstLine isn't available yet.",
      },
      {
        q: "What if a website has nothing useful?",
        a: "Then the lead gets a neutral line instead of a made-up one, and it costs 0 credits. You only pay for emails that were actually personalised.",
      },
      {
        q: "Is it GDPR-compliant?",
        a: "FirstLine is built for lawful B2B outreach. Research uses only public company websites, never LinkedIn. Lead data is deleted 30 days after a campaign ends. A data processing agreement is available, and the sub-processors are listed openly. You still need a lawful basis, such as legitimate interest, to email your leads.",
      },
      {
        q: "How is this different from Instantly or Clay?",
        a: "Instantly and Lemlist are sending platforms; Clay is a data and research workbench. FirstLine does one job: it reads each lead's website and writes the personal lines in your own email, with sources, and you pay per email. It works alongside them: push the results to Instantly, Smartlead or Lemlist, or send from Gmail.",
      },
    ],
  },

  honestLine: "Not for blasting 50,000 emails a day. Built for people who want replies, not volume.",
  founderNote: "Built by a team that runs cold outreach every day.",

  finalCta: {
    title: "25 free emails, no card, credits never expire.",
    sub: "Try it on your own leads.",
    cta: "Personalise 25 leads free",
  },

  footer: { privacy: "Privacy", terms: "Terms", dpa: "DPA", subprocessors: "Sub-processors" },
} as const;
