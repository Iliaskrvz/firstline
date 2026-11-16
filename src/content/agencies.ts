// Copy for /agencies (English only) and its "Talk to us" form, including the form's error messages
// (also used by /api/contact). Prices from src/config/packs.ts; no volume deals are promised here.
import { CONTACT_VOLUMES } from "@/lib/contact";

export const AGENCIES = {
  eyebrow: "For agencies",
  title: "Personalised outreach for every client, priced per email.",
  titleMuted: "From €0.030 per email.",
  intro:
    "Run campaigns for several clients from one login, each in its own workspace with its own leads, templates, credits and inboxes. Every line comes with the page it came from, so you can show clients why it was written.",
  cta: "Talk to us",
  secondary: "Personalise 25 leads free",
  sections: {
    workspaces: {
      eyebrow: "Workspaces",
      title: "One workspace per client",
      points: [
        { title: "Kept apart", text: "Leads, templates, campaigns, credits and API keys are separate per client. Switch between them from the menu." },
        { title: "Their inbox, their reputation", text: "Each client's emails go out from their own Gmail or Google Workspace inbox, or from your sending tool." },
        { title: "Team access", text: "Invite colleagues to the workspaces they work on, so nobody shares a password." },
      ],
    },
    volume: {
      eyebrow: "Volume packs",
      title: "Buy in bulk, use across months",
      text: "Credits never expire and only finished emails use one, so a big pack doesn't go to waste in a quiet month.",
      note: "Prices excl. VAT. Sending more than 10,000 a month across clients? Tell us your volume below.",
      perEmail: "per email",
      packLine: (credits: string, price: string) => `${credits} emails · ${price}`,
    },
    proof: {
      eyebrow: "Client-ready output",
      title: "Show your client where every line came from",
      text: "Every personalised line links to the fact and the page behind it. Generic, salesy or unsupported lines are rewritten before you see them, and leads with nothing useful get a neutral line at no cost.",
    },
  },
  form: {
    eyebrow: "Talk to us",
    title: "Tell us about your clients and volume",
    text: "We reply within two working days, usually sooner.",
    name: "Your name",
    email: "Work email",
    company: "Agency",
    volume: "Emails a month, all clients together",
    volumes: CONTACT_VOLUMES,
    volumePlaceholder: "Choose one",
    message: "Anything we should know (optional)",
    messagePlaceholder: "How many clients, which sending tools, what you'd like to set up.",
    submit: "Send",
    sending: "Sending…",
    sent: "Thanks. We got your message and will reply by email.",
    privacy: "We use your details only to answer this request and delete them after 180 days.",
    errors: {
      name: "Enter your name.",
      email: "Enter a valid email address.",
      volume: "Choose roughly how many emails a month.",
      captcha: "Please confirm you're not a robot, then try again.",
      ipLimit: "You've sent a few requests today already. We'll reply to those.",
      dailyCap: "We can't take more requests today. Email us instead, or try again tomorrow.",
      generic: "Something went wrong. Try again.",
      network: "Couldn't reach FirstLine. Check your connection and try again.",
    },
  },
};
