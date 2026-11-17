// Header, footer and other copy shared by every marketing page, in English and Dutch.
// Voice: calm, factual, direct. No exclamation marks, no hype words.

export type Locale = "en" | "nl";

export type SiteCopy = {
  skip: string;
  menu: string;
  home: string;
  nav: { label: string; href: string }[];
  signIn: string;
  cta: string;
  ctaShort: string;
  /** Label of the link to the other language. */
  switchTo: string;
  switchLang: Locale;
  footer: {
    product: string;
    company: string;
    legal: string;
    links: { product: { label: string; href: string }[]; company: { label: string; href: string }[]; legal: { label: string; href: string }[] };
  };
};

export const SITE: Record<Locale, SiteCopy> = {
  en: {
    skip: "Skip to content",
    menu: "Menu",
    home: "FirstLine, home",
    nav: [
      { label: "How it works", href: "/#how" },
      { label: "Pricing", href: "/#pricing" },
      { label: "Compare", href: "/compare" },
      { label: "Agencies", href: "/agencies" },
      { label: "For developers / API", href: "/docs/api" },
    ],
    signIn: "Sign in",
    cta: "Personalise 25 leads free",
    ctaShort: "Try free",
    switchTo: "Nederlands",
    switchLang: "nl",
    footer: {
      product: "Product",
      company: "Who it's for",
      legal: "Trust and legal",
      links: {
        product: [
          { label: "How it works", href: "/#how" },
          { label: "Pricing", href: "/#pricing" },
          { label: "Compare tools", href: "/compare" },
          { label: "Cost calculator", href: "/calculator" },
          { label: "API docs", href: "/docs/api" },
        ],
        company: [
          { label: "Small businesses", href: "/for-small-business" },
          { label: "Automation builders", href: "/for-automation-builders" },
          { label: "Agencies", href: "/agencies" },
          { label: "Nederlands", href: "/nl" },
        ],
        legal: [
          { label: "Trust and data", href: "/trust" },
          { label: "Privacy", href: "/privacy" },
          { label: "Terms", href: "/terms" },
          { label: "DPA", href: "/dpa" },
          { label: "Sub-processors", href: "/subprocessors" },
        ],
      },
    },
  },
  nl: {
    skip: "Naar de inhoud",
    menu: "Menu",
    home: "FirstLine, home",
    nav: [
      { label: "Zo werkt het", href: "/nl#how" },
      { label: "Prijzen", href: "/nl#pricing" },
      { label: "Kleine bedrijven", href: "/nl/kleine-bedrijven" },
      { label: "Automation builders", href: "/nl/automation-builders" },
    ],
    signIn: "Inloggen",
    cta: "Personaliseer 25 leads gratis",
    ctaShort: "Gratis proberen",
    switchTo: "English",
    switchLang: "en",
    footer: {
      product: "Product",
      company: "Voor wie",
      legal: "Vertrouwen en juridisch",
      links: {
        product: [
          { label: "Zo werkt het", href: "/nl#how" },
          { label: "Prijzen", href: "/nl#pricing" },
          { label: "Tools vergelijken (Engels)", href: "/compare" },
          { label: "Kostencalculator (Engels)", href: "/calculator" },
          { label: "API-documentatie (Engels)", href: "/docs/api" },
        ],
        company: [
          { label: "Kleine bedrijven", href: "/nl/kleine-bedrijven" },
          { label: "Automation builders", href: "/nl/automation-builders" },
          { label: "Bureaus (Engels)", href: "/agencies" },
          { label: "English", href: "/" },
        ],
        legal: [
          { label: "Vertrouwen en data (Engels)", href: "/trust" },
          { label: "Privacy (Engels)", href: "/privacy" },
          { label: "Voorwaarden (Engels)", href: "/terms" },
          { label: "Verwerkersovereenkomst (Engels)", href: "/dpa" },
          { label: "Subverwerkers (Engels)", href: "/subprocessors" },
        ],
      },
    },
  },
};

/** Number formatting per language: 2,000 vs 2.000, €0.038 vs €0,038. */
export const fmtInt = (n: number, locale: Locale) => n.toLocaleString(locale === "nl" ? "nl-NL" : "en-US");
export const fmtEuro = (amount: number, locale: Locale, digits?: number) =>
  new Intl.NumberFormat(locale === "nl" ? "nl-NL" : "en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits ?? (Number.isInteger(amount) ? 0 : 2),
    maximumFractionDigits: digits ?? 2,
  }).format(amount);
