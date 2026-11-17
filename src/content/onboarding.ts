// The first screen after sign-up (/campaigns with no campaigns yet): the path to a first result,
// one step at a time. Small first steps get people to the free preview, where FirstLine shows its value.
export const ONBOARDING = {
  title: "Your first campaign",
  credits: (n: string) => `You have ${n} credits. The preview of 5 leads is free.`,
  steps: [
    {
      title: "Upload a CSV of leads",
      text: "Columns: email, first name, company and website. Job title and last name are optional. Any extra columns become variables.",
      time: "About 1 minute",
    },
    {
      title: "Paste your own email",
      text: "Mark the spot to personalise with [[opener]]. Everything else stays word for word.",
      time: "About 2 minutes",
    },
    {
      title: "Check the free preview",
      text: "5 leads, each line with the fact and page it came from. Adjust your email until you like them.",
      time: "A few minutes",
    },
    {
      title: "Run it and send",
      text: "Write the rest, then send from your own Gmail with safe limits, or export to your sending tool.",
      time: "When you're ready",
    },
  ],
  cta: "Upload leads",
  template: "Download a CSV template",
  templateHref: "/firstline-leads-template.csv",
};
