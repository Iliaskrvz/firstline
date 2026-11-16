// Copy for /trust: one page that bundles how FirstLine handles data, in plain words, with links to the
// legal documents. Every statement must match the privacy policy, DPA and sub-processor list
// (src/lib/legal.ts, src/app/(public)/*) and the code. Change those first, then this page.

export const TRUST = {
  eyebrow: "Trust and data",
  title: "What happens to your data, in plain words",
  intro:
    "FirstLine reads public company websites and writes lines for your emails. Here's exactly what it reads, who processes what, where it's stored and when it's deleted. The legal documents below have the binding version.",
  sections: [
    {
      id: "reads",
      title: "What FirstLine reads",
      points: [
        "Only the public website of each lead's company: a few pages such as the homepage, news and about pages.",
        "It respects robots.txt: when a site asks robots not to read a page, FirstLine doesn't.",
        "It never logs in anywhere and never scrapes LinkedIn or other social networks. Names and job titles come only from your own list.",
      ],
    },
    {
      id: "ai",
      title: "What the AI sees, including the review step",
      points: [
        "To find facts and write a line, the AI provider receives the website text and the lead details listed on the sub-processors page, nothing more.",
        "The review step that checks every line before you see it runs on the same provider with the same data: the written line, the facts and your template. Its verdicts are stored with the campaign and deleted with it.",
        "Your leads are never used to train AI models, by us or by our AI provider.",
      ],
    },
    {
      id: "stored",
      title: "Where it's stored",
      points: [
        "Database and sign-in: Supabase, in the EU (Ireland).",
        "The application itself runs on the server listed on the sub-processors page.",
        "API keys you enter for your sending tools are stored encrypted. Each workspace's data is kept apart in the database, so one customer can never read another's.",
      ],
    },
    {
      id: "deleted",
      title: "When it's deleted",
      points: [
        "Lead data (names, emails, generated copy): 30 days after a campaign ends. A campaign ends when you end it, or by itself after 90 days without activity.",
        "Company website facts: kept for up to 30 days so the same site isn't read twice.",
        "Your account: deleted within 30 days after you close it.",
        "Homepage demo: the website someone tried and a scrambled form of their IP address, deleted after 30 days.",
        "Contact requests from the agencies page: deleted after 180 days.",
      ],
    },
    {
      id: "sending",
      title: "Sending",
      points: [
        "Emails go out from your own Gmail or Google Workspace account through a Google Sheet you install yourself. FirstLine never receives your Google password or access to your mailbox.",
        "Replies, bounces and unsubscribes are added to a suppression list, so the same person isn't emailed again.",
      ],
    },
  ],
  onThisPage: "On this page",
  subprocessorsTitle: "Who processes what",
  subprocessorsNote: "The full list with the legal basis for transfers outside the EU is on the sub-processors page. New ones are announced there at least 14 days before they start.",
  columns: { company: "Company", purpose: "What for", location: "Where" },
  docsTitle: "The documents",
  docs: [
    { title: "Privacy policy", text: "What we store, why, for how long, and your rights.", href: "/privacy" },
    { title: "Terms of service", text: "Credits, acceptable use and your responsibility for lawful outreach.", href: "/terms" },
    { title: "Data processing agreement", text: "For customers who upload lead data: our duties as your processor.", href: "/dpa" },
    { title: "Sub-processors", text: "Every provider, what it receives and where.", href: "/subprocessors" },
  ],
  yourPart: {
    title: "Your part",
    text: "You decide who to email and need a lawful basis for it, such as legitimate interest for relevant B2B outreach. Keep your list relevant, honour unsubscribes, and tell people where you got their details if they ask.",
  },
  cta: { title: "Questions about data?", sub: "Ask us before you upload anything.", cta: "Read the privacy policy", href: "/privacy" },
};
