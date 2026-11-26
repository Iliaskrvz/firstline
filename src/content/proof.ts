// Proof content: case studies and the demo video. EVERYTHING HERE IS A PLACEHOLDER until the owner
// replaces it with real content. Placeholders are never shown in production (src/lib/proof.ts).
// To publish a real case study: fill in the fields, set placeholder: false, set SHOW_PROOF=1, deploy.

export type CaseStudy = {
  placeholder: boolean;
  /** Who: role and kind of company, e.g. "Founder of a 4-person bookkeeping firm". Only with their written OK. */
  who: string;
  /** Optional company name, only with their written OK. */
  company?: string;
  /** Reply rate before and after, as percentages, with the number of emails each is based on. */
  before: { replyRate: number; emails: number };
  after: { replyRate: number; emails: number };
  /** Three numbers that tell the story, e.g. { value: "312", label: "emails sent in 3 weeks" }. */
  numbers: [{ value: string; label: string }, { value: string; label: string }, { value: string; label: string }];
  /** One sentence in their words, approved by them. */
  quote: string;
  /** Name and role under the quote. */
  quoteBy: string;
};

export const CASE_STUDIES: CaseStudy[] = [
  {
    placeholder: true,
    who: "PLACEHOLDER · Founder of a small B2B service company",
    before: { replyRate: 0, emails: 0 },
    after: { replyRate: 0, emails: 0 },
    numbers: [
      { value: "000", label: "PLACEHOLDER · emails sent" },
      { value: "00", label: "PLACEHOLDER · replies" },
      { value: "0", label: "PLACEHOLDER · meetings booked" },
    ],
    quote: "PLACEHOLDER · a real quote from a real customer goes here.",
    quoteBy: "PLACEHOLDER · Name, role",
  },
];

/**
 * Results from the owner's own outreach with FirstLine (owner's request 2026-11-26). Hidden until
 * SHOW_PROOF=1 AND placeholder is false. Fill in real numbers only: emails actually sent in the period,
 * and reply rates measured the same way before and after (e.g. replies / delivered emails).
 */
export type OwnOutreachResult = {
  placeholder: boolean;
  /** Emails sent with FirstLine in the period. */
  emailsSent: number;
  /** Reply rate before FirstLine, as a percentage (e.g. 2.4), on comparable campaigns. */
  replyRateBefore: number;
  /** Reply rate with FirstLine, as a percentage, over the same kind of campaigns. */
  replyRateAfter: number;
  /** The period the numbers cover, as you want it shown, e.g. "December 2026 – January 2027". */
  period: string;
};

export const OWN_OUTREACH: OwnOutreachResult = {
  placeholder: true,
  emailsSent: 0,
  replyRateBefore: 0,
  replyRateAfter: 0,
  period: "PLACEHOLDER · e.g. December 2026 – January 2027",
};

/**
 * The 60 to 90 second demo video on the homepage. Hidden while src is null.
 * Put the file in public/video/ (MP4, H.264, under ~15 MB) and set src to "/video/<file>.mp4".
 * Script: docs/marketing/demo-video-script.md.
 */
export const DEMO_VIDEO: { src: string | null; poster: string | null; captions: string | null; durationLabel: string } = {
  src: null,
  poster: null,
  /** Optional WebVTT subtitles, e.g. "/video/demo.en.vtt". */
  captions: null,
  durationLabel: "1:20",
};

export type Testimonial = {
  placeholder: boolean;
  /** Their words, unedited apart from typos, approved by them in writing. Keep the original language. */
  quote: string;
  name: string;
  /** Role and company, as they want it shown. */
  role: string;
  language: "en" | "nl";
  /** Optional photo in public/proof/, only with their permission. */
  photo?: string;
};

/** 3 to 5 real quotes from beta users. All placeholders until then. */
export const TESTIMONIALS: Testimonial[] = [1, 2, 3].map((i) => ({
  placeholder: true,
  quote: `PLACEHOLDER ${i} · a real quote from a beta user goes here, in their own words.`,
  name: "PLACEHOLDER · Name",
  role: "PLACEHOLDER · Role, company",
  language: "en" as const,
}));

export type CustomerLogo = {
  placeholder: boolean;
  name: string;
  /** SVG or PNG in public/proof/logos/, used only with the customer's written permission. */
  src: string;
  width: number;
  height: number;
};

/** Customer logos for the strip under the hero. Placeholders until you have written permission. */
export const CUSTOMER_LOGOS: CustomerLogo[] = [1, 2, 3, 4, 5].map((i) => ({
  placeholder: true,
  name: `Placeholder customer ${i}`,
  src: "",
  width: 120,
  height: 32,
}));
