// Copy for /calculator. Prices come from src/config/packs.ts and src/content/competitors.ts.
export const CALCULATOR = {
  eyebrow: "Cost calculator",
  title: "What would your volume cost?",
  intro: "Enter how many personalised emails you send a month. FirstLine is priced per email; the other tools by monthly plan, as shown on their public pricing pages.",
  inputLabel: "Emails per month",
  presets: [100, 300, 1_000, 3_000, 10_000],
  firstLine: "FirstLine",
  firstLineDetail: (perEmail: string, pack: string) => `${perEmail} per email at the ${pack} pack price. Credits never expire, so unused ones carry over.`,
  yearly: (amount: string) => `${amount} a year`,
  tool: "Tool",
  monthly: "Per month",
  difference: "Difference",
  more: (amount: string) => `${amount} more than FirstLine`,
  less: (amount: string) => `${amount} less than FirstLine`,
  rangeNote: "Between 300 and 10,000 a month their pages list several plans; we show the range from the plan that covers 300 to the one that covers 10,000.",
  copy: "Copy link to this comparison",
  copied: "Link copied",
  note:
    "Competitor prices are monthly billing as shown on each pricing page, in the page's currency, on the date checked; some show a lower yearly price. FirstLine prices exclude VAT. Leads with nothing useful on their website cost 0 credits, so your real FirstLine cost can be lower.",
  compareLink: "What each tool does, side by side",
  cta: { title: "Check the quality before you count the savings", sub: "25 free emails, no card, credits never expire.", cta: "Personalise 25 leads free" },
};
