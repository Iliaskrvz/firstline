// Meta title, description and share (OG) text for the public pages (the homepage's own lives in
// src/content/home.ts and home.nl.ts). Titles get " · FirstLine" from the root layout.
// Pages that exist in English and Dutch link to each other with hreflang (alternates.languages).
import type { Metadata } from "next";
import type { HomeCopy } from "./home";
import type { Locale } from "./site";

type PageMeta = { title: string; description: string; ogTitle?: string };

export const PAGE_META = {
  signup: {
    title: "Create an account",
    description: "Create a FirstLine account and personalise 25 leads free. No card, credits never expire.",
    ogTitle: "Personalise 25 leads free with FirstLine",
  },
  login: { title: "Sign in", description: "Sign in to FirstLine with your password, a passkey, Google or a link by email." },
  forgotPassword: { title: "Reset your password", description: "Get a link by email to choose a new FirstLine password." },
  apiDocs: {
    title: "API docs",
    description: "Personalise cold emails from your own code, n8n or Make: one lead in, a researched line with its sources out. Same credits as the app.",
    ogTitle: "FirstLine API: researched first lines in your own flow",
  },
  privacy: { title: "Privacy policy", description: "What FirstLine stores, why, for how long, and who processes it. Lead data is deleted 30 days after a campaign ends." },
  terms: { title: "Terms of service", description: "The terms for using FirstLine: credits, acceptable use, and your responsibility for lawful outreach." },
  dpa: { title: "Data Processing Agreement", description: "FirstLine's data processing agreement for customers who upload lead data." },
  subprocessors: { title: "Sub-processors", description: "The providers FirstLine uses to process data, what each one receives and where." },
  compare: {
    title: "FirstLine vs Clay, Lemlist, Instantly, Lyne.ai and Smartwriter",
    description: "What each tool does, what 300 and 10,000 personalised emails a month cost on their public pricing pages, and when FirstLine fits. Sources and dates included.",
    ogTitle: "Cold email personalisation tools compared, with sources",
  },
  calculator: {
    title: "Cold email personalisation cost calculator",
    description: "Enter how many emails you send a month and see what FirstLine costs next to the public prices of Clay, Lemlist, Instantly and Smartwriter.",
    ogTitle: "What does personalising your cold emails cost?",
  },
  examples: {
    title: "Example openers by industry",
    description: "Real FirstLine openers for bakeries, agencies, SaaS, accountants and more, each with the facts and pages it used.",
  },
  automation: {
    title: "FirstLine for automation builders",
    description: "Researched first lines inside your own n8n, Make or code flows. One lead in, a line with its sources out, €0.03 per email at volume.",
    ogTitle: "Researched cold email lines for your automations",
  },
  smallBusiness: {
    title: "FirstLine for small businesses",
    description: "Send researched cold emails from your own Gmail, with no setup and safe limits. 300 emails cost about €10, no subscription.",
    ogTitle: "Cold emails your prospects can tell you researched, from your own Gmail",
  },
  agencies: {
    title: "FirstLine for agencies",
    description: "Volume packs from €0.03 per email, a separate workspace per client, and sending from each client's own inbox. Talk to us about your volume.",
    ogTitle: "Personalised outreach for every client, per email",
  },
  trust: {
    title: "Trust and data",
    description: "How FirstLine handles your data: what it reads, where it's stored, who processes it, when it's deleted, and why it never scrapes LinkedIn.",
  },
  automationNl: {
    title: "FirstLine voor automation builders",
    description: "Onderzochte openingszinnen in je eigen n8n-, Make- of codeflows. Eén lead erin, een zin met bronnen eruit, €0,03 per e-mail bij volume.",
    ogTitle: "Onderzochte cold e-mailzinnen voor je automations",
  },
  smallBusinessNl: {
    title: "FirstLine voor kleine bedrijven",
    description: "Verstuur onderzochte cold e-mails vanuit je eigen Gmail, zonder installatie en met veilige limieten. 300 e-mails kosten ongeveer €10, geen abonnement.",
    ogTitle: "Cold e-mails waarvan je prospect ziet dat je hebt opgelet",
  },
} satisfies Record<string, PageMeta>;

/** English and Dutch versions of the same page, for hreflang. */
export const LANGUAGE_PAIRS = {
  home: { en: "/", nl: "/nl" },
  smallBusiness: { en: "/for-small-business", nl: "/nl/kleine-bedrijven" },
  automation: { en: "/for-automation-builders", nl: "/nl/automation-builders" },
} as const;

function languages(pair: { en: string; nl: string }) {
  return { en: pair.en, nl: pair.nl, "x-default": pair.en };
}

export function homeMetadata(t: HomeCopy, locale: Locale): Metadata {
  const pair = LANGUAGE_PAIRS.home;
  return {
    title: { absolute: t.meta.title },
    description: t.meta.description,
    alternates: { canonical: pair[locale], languages: languages(pair) },
    openGraph: { title: t.meta.ogTitle, description: t.meta.ogDescription, type: "website", siteName: "FirstLine", locale: locale === "nl" ? "nl_NL" : "en_GB", url: pair[locale] },
    twitter: { card: "summary_large_image", title: t.meta.ogTitle, description: t.meta.ogDescription },
  };
}

/** Metadata for a marketing page; `pair` adds hreflang links to its other-language version. */
export function marketingMetadata(key: keyof typeof PAGE_META, path: string, pair?: { en: string; nl: string }): Metadata {
  const m: PageMeta = PAGE_META[key];
  const nl = pair?.nl === path;
  return {
    title: m.title,
    description: m.description,
    alternates: { canonical: path, ...(pair ? { languages: languages(pair) } : {}) },
    openGraph: { title: m.ogTitle ?? `${m.title} · FirstLine`, description: m.description, siteName: "FirstLine", type: "website", url: path, locale: nl ? "nl_NL" : "en_GB" },
  };
}

export function pageMetadata(key: keyof typeof PAGE_META): Metadata {
  const m: PageMeta = PAGE_META[key];
  return {
    title: m.title,
    description: m.description,
    openGraph: { title: m.ogTitle ?? `${m.title} · FirstLine`, description: m.description, siteName: "FirstLine", type: "website" },
  };
}
