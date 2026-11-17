# Product Marketing Context

*Last updated: 2026-11-17 (V1.1: site review; drafted from SPEC.md, the codebase and the owner's positioning decisions)*

## Product Overview
**One-liner:** Your copy, researched per lead, with sources. From €0.03 per email, no subscription, sent free from your Gmail.
**What it does:** You upload a lead list and paste your own cold email with a few marked spots. FirstLine reads each lead's company website, finds real facts, and writes only those spots. Every claim cites the fact and the page it came from. The rest of your email stays word for word. Emails go out from your own Gmail (free), or into Instantly, Smartlead or Lemlist, or out as a CSV.
**Product category:** Cold email personalisation. People search for "AI cold email personalization", "personalized first lines", "icebreaker generator" and "Clay alternative".
**Product type:** Self-serve B2B SaaS (web app, public API, n8n node, Make app).
**Business model:**
- Prepaid credits, no subscription. 1 credit = 1 finished personalised email. Credits never expire.
- Packs (excl. VAT): Starter 500 = €19 (€0.038 per email), Growth 2,000 = €69 (€0.035), Agency 10,000 = €299 (€0.030).
- 25 free credits after email confirmation. Free preview of 5 leads per campaign.
- No facts found means a neutral line and 0 credits. Gmail sending and plain follow-ups are free; personalised follow-ups cost 1 credit.

## Target Audience
**Target companies:**
- **Homepage primary ICP:** small B2B senders. That means founders, owner-run agencies, consultants and small sales teams sending 50–600 cold emails a month from their own Gmail, with no sending tool.
- **Second ICP:** AI automation builders (300–3,000 emails/month). They use the API, n8n or Make, and may resell personalisation inside client systems. They get their own page and the API path.
- **Welcome:** bigger senders already on Instantly, Smartlead or Lemlist (10k–100k+/month) who want personalisation pushed into their campaigns.

**Decision-makers:** the founder or owner (small B2B), the automation builder or freelancer, the agency owner.
**Primary use case:** write a personal, researched opening line for every lead in a cold campaign, without spending minutes per lead and without a monthly tool subscription.
**Jobs to be done:**
- "Make my cold email feel like I looked at their company, for every lead, without doing the research myself."
- "Keep my own pitch and tone, and only personalise the part that should be personal."
- "Personalise inside my own automation, or my client's, and pay per use."

**Use cases:**
- A founder sends 200 cold emails a month from Gmail to local B2B companies.
- An agency personalises outreach for several clients, one workspace per client.
- An automation builder adds a "personalise" step to an n8n or Make flow.
- A team on Instantly pushes personalised lines into an existing campaign.

## Personas
| Persona | Cares about | Challenge | Value we promise |
|---------|-------------|-----------|------------------|
| Small B2B owner / founder | Replies, low cost, no setup, not burning their Gmail | No time to research every lead; generic AI lines get ignored; tools cost a monthly fee | Researched emails from their own Gmail, about €10 per 300 emails, safe sending limits |
| AI automation builder | A reliable API, predictable cost per call, something they can resell | Building and maintaining their own research + writing pipeline | REST API, n8n node and Make app; pay per email; volume packs |
| Agency owner | Per-client separation, volume price, quality they can show clients | Personalisation at scale without hiring researchers | Workspaces per client, volume packs, sources on every line |
| Team on a sending tool | Better reply rates inside their existing stack | Their tool sends, but doesn't research | Push personalised lines into Instantly / Smartlead / Lemlist |

## Problems & Pain Points
**Core problem:** Cold emails with generic openers get ignored. Real personalisation means researching each company, which takes minutes per lead.
**Why alternatives fall short:**
- Generic AI openers ("I came across your company and was impressed…") are recognisable and read as spam.
- Doing the research by hand doesn't scale: 5 minutes per lead is 25 hours for 300 leads.
- Personalisation and enrichment tools charge a monthly subscription and often rewrite the whole email. Exact competitor prices go in src/content/competitors.ts, verified with date and source.
- Writers that invent details create embarrassing, untrue claims.

**What it costs them:** hours of research, low reply rates, a subscription paid even in quiet months, and damage to the sender's reputation when a line is wrong.
**Emotional tension:** "Will this sound fake?", "Will my Gmail get blocked?", "Is it allowed (GDPR)?", "Another subscription I'll forget to cancel."

## Competitive Landscape
**Direct:** AI first-line and personalisation tools (Lyne.ai, Smartwriter). They are subscription-priced, and it isn't always clear where a "fact" came from.
**Secondary:** Clay (enrichment and research workbench). Powerful, but a learning curve and a monthly plan, too much for a 300-email sender. Lemlist and Instantly (sending platforms with AI features) are subscription-based and built around their own sending.
**Indirect:** doing it by hand, a VA or researcher, or a generic ChatGPT prompt. These are slow, hard to scale or untrustworthy.

## Differentiation
**Key differentiators:**
- Your own copy stays word for word. The AI only writes the spots you mark.
- Every claim cites a fact and the page it came from. No made-up facts.
- No facts found means no charge (a neutral line, 0 credits).
- Pay per finished email, no subscription, credits never expire.
- Sending from your own Gmail is free, with built-in safety limits.
- An API, n8n node and Make app for automation builders.
- Never scrapes LinkedIn. Research uses only the company's public website.

**How we do it differently:** we research the company's own website, extract facts with IDs, write only the marked slots, then check every line with code checks and an AI reviewer before you see it.
**Why that's better:** it reads like someone looked, it stays true, it sounds like you, and it costs cents.
**Why customers choose us:** TODO (owner, from real customer conversations).

## Objections
| Objection | Response |
|-----------|----------|
| "AI sounds fake." | It only writes the personal spots in your own email, from real facts with sources. A reviewer rejects generic or salesy lines. |
| "My Gmail will get blocked." | Careful defaults: 10 emails a day at first, up to 30; 6–14 minutes between emails; weekdays only; it steps back when bounces pass 3%. We recommend a separate outreach domain. No one can promise zero risk. |
| "Is this GDPR-compliant?" | Public company websites only, no LinkedIn scraping, lead data deleted 30 days after a campaign ends, DPA available. The customer needs a lawful basis to contact their leads. Final wording follows the lawyer's review of the AI sub-processor. |
| "I already use Instantly / Lemlist." | Keep it. FirstLine pushes personalised lines into Instantly, Smartlead or Lemlist, or exports a CSV. |
| "Why not just ChatGPT?" | One prompt per lead with no research, no sources and no checks. FirstLine reads the site, cites facts, checks the line, and charges nothing when it finds nothing. |

**Anti-persona:** mass-mailers (50,000 emails a day), B2C senders, and people without their own email copy who want the AI to write the whole email.

## Switching Dynamics
**Push:** low reply rates from generic openers; hours lost to manual research; paying a monthly subscription in quiet months.
**Pull:** cents per email; your own copy kept; a source behind every line; free preview; free Gmail sending.
**Habit:** "My current template works well enough"; an existing tool already paid for; manual research feels safer.
**Anxiety:** sounding fake; Gmail getting blocked; legal risk; wasting credits on bad lines. Answered by the free preview, the 0-credit fallback, the safety limits and the trust page.

## Customer Language
**How they describe the problem:**
- TODO (owner: collect verbatim quotes from beta users and sales calls)

**How they describe us:**
- TODO (owner)

**Words to use:** researched, sources, your own copy, first line, per lead, per email, no subscription, credits never expire, free preview, from your own Gmail.
**Words to avoid:** revolutionary, supercharge, unlock, game-changer, 10x, "AI magic", hyper-personalised, guaranteed replies, exclamation marks.

**Glossary:**
| Term | Meaning |
|------|---------|
| Slot | A marked spot in your email that FirstLine writes, e.g. `[[opener]]` |
| Fact / source | A fact from the lead's website with an ID (F1, F2…) and the page it came from |
| Credit | 1 finished personalised email |
| Fallback | A neutral line used when a website has nothing useful; costs 0 credits |
| Preview | 5 free leads per campaign before it runs |
| Sender Sheet | The Google Sheet + script that sends from your own Gmail |

## Brand Voice
**Tone:** calm, factual, direct (Dutch-direct). No hype.
**Style:** short sentences, concrete numbers, plain words. Show the mechanism ("every line shows where it came from") rather than claim quality.
**Personality:** honest, precise, practical, understated, helpful.

## Proof Points
**Metrics:** TODO (owner; real numbers only, no invented stats)
**Customers:** TODO (owner)
**Testimonials:**
> TODO — real quotes only, behind SHOW_PROOF until supplied

**Value themes:**
| Theme | Proof |
|-------|-------|
| No made-up facts | Every line cites a fact ID and source URL (product behaviour, visible in the preview) |
| Pay only for results | 0 credits when no facts are found (product rule) |
| Cheap | €0.030–0.038 per email; pack prices on /pricing |
| Safe sending | Warm-up 10→30/day, 6–14 min gaps, bounce step-back at 3% (in code) |

## Goals
**Business goal:** paying small B2B senders and automation builders; self-serve growth.
**Conversion action:** "Personalise 25 leads free" (sign up, then run the free preview). Next: the first pack purchase.
**Current metrics:** TODO (owner)

## Open items before this copy goes live
- **AI provider:** production must run on a real AI provider (DeepSeek pending the lawyer, or Anthropic). Without one, the app shows test output, and promises like "researched first lines" aren't true for visitors yet.
- **"First emails in about 10 minutes":** check on real runs once the AI provider is live.
- **Editing single emails inside the app isn't available yet.** The FAQ says so honestly.
- **No usage data yet:** pricing badges say "Recommended", not "Most popular", until real purchase data backs a popularity claim.
- **Pricing research to do once there are customers:** a short Van Westendorp survey (4 questions) with the first 20–30 users before any price change.
