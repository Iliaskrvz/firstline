// Meta title, description and share (OG) text for the public pages other than the homepage
// (src/content/home.ts). Titles get " · FirstLine" from the root layout.
import type { Metadata } from "next";

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
} satisfies Record<string, PageMeta>;

export function pageMetadata(key: keyof typeof PAGE_META): Metadata {
  const m: PageMeta = PAGE_META[key];
  return {
    title: m.title,
    description: m.description,
    openGraph: { title: m.ogTitle ?? `${m.title} · FirstLine`, description: m.description, siteName: "FirstLine", type: "website" },
  };
}
