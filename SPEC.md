# FirstLine — Product & Build Spec

> Put this file in the root of the project folder. Claude Code: read this whole file before writing code, and keep it as the source of truth. If something here conflicts with what you think is best, flag it and ask; don't silently change the design.

---

## 1. What we're building

FirstLine is a **pay-per-use cold email tool**. A user:

1. uploads a lead list (CSV),
2. pastes their own cold email with marked personalisation slots,
3. FirstLine researches each lead's **company website** (plus optional extras) and writes only the slots, keeping the rest of the copy word for word,
4. the emails are **sent from the user's own Gmail** (via a script in their own Google account) **or pushed to Instantly / Smartlead / Lemlist**, or exported as CSV.

Pricing: **prepaid credits, no subscription.** 1 credit = 1 personalised email. Price = (real cost per email) × 3. Must stay much cheaper than Clay, Lemlist, Instantly, Lyne.ai and Smartwriter, especially for small senders.

### Who it's for
- **Core ICP 1:** people who build and sell AI automations (300–3,000 emails/month, Gmail first, API later, may resell inside client systems).
- **Core ICP 2:** small B2B business owners on a budget (50–600 emails/month, own Gmail, no sending tool).
- **Welcome:** bigger senders (10k–100k+/month) who already use Instantly/Smartlead/Lemlist and want personalisation pushed into their campaigns.

### Non-negotiable product rules
- FirstLine **never runs its own mail servers.** Sending happens in the customer's Gmail (their script) or their sending tool.
- The AI only writes **slots**. The user's copy stays intact.
- **Every claim about a lead must cite a fact ID** found in research. No invented facts, ever.
- **Only charge for success.** If research finds nothing usable, use a neutral fallback (or skip) and charge 0 credits.
- **Free preview** of 5 leads before a campaign runs.
- **Never scrape LinkedIn.** Decision-maker info comes only from the user's CSV, or the optional "Deep" web search.

---

## 2. Tech stack

| Part | Choice |
|---|---|
| App | Next.js (App Router) + TypeScript + Tailwind |
| Auth / DB / storage / realtime | Supabase (Postgres with Row Level Security on every table) |
| Background jobs | Trigger.dev **or** a Node worker with `pg-boss` on my own VPS. Start with whichever is simpler; keep job code framework-agnostic in `src/engine/` |
| AI | Anthropic API: `claude-haiku-5-5` (fact extraction, validation, judge), `claude-sonnet-5-5` (writing). Use prompt caching for the static parts of prompts. Batch API for "Economy" mode later |
| Website research | Firecrawl (`map` + `scrape` to markdown) |
| Optional research | Firecrawl search (Deep), Google Places API (New) for reviews (Local) |
| Payments | Stripe Checkout (iDEAL / Wero + cards), Stripe Tax, webhooks |
| System emails | Resend (receipts, "campaign done", "inbox offline"); never cold email |
| Gmail sending | Google Sheet template + Apps Script (the "Sender Sheet") in the customer's own Google account |
| Tests | Vitest for all pure logic |

All secrets in `.env.local` (and a committed `.env.example` with empty values). Never commit keys.

---

## 3. Data model (Postgres / Supabase)

Every table has `workspace_id` (except global tables) and RLS so users only see their own workspace.

```
workspaces        id, name, owner_id, stripe_customer_id, auto_topup jsonb, created_at
workspace_members workspace_id, user_id, role (owner|member)

credit_ledger     id, workspace_id, type (purchase|bonus|reserve|capture|release|refund),
                  amount int (+/-), campaign_id null, lead_id null,
                  stripe_event_id unique null, note, created_at
                  -- append-only. Balance = sum(amount). NEVER update a balance column.
                  -- available = purchases+bonus+refund+release - reserve ... implement as a view
                  -- `workspace_balance(workspace_id, available, reserved)`.

templates         id, workspace_id, name, subject, body,         -- body contains {{vars}} and [[slots]]
                  slots jsonb  [{key, instruction, max_words}],
                  style_rules jsonb {language, tone, banned_phrases[], extra_rules[]},
                  examples jsonb  -- preview feedback (👍/👎 + edits) used as few-shot

campaigns         id, workspace_id, template_id, name,
                  status (draft|preview|running|done|cancelled),
                  mode (now|economy), depth jsonb {deep:bool, local:bool},
                  writer (pro|lite), column_map jsonb, counts jsonb,
                  holdout_pct int default 0, created_at

leads             id, campaign_id, workspace_id, email, first_name, last_name, company,
                  title, linkedin_headline,          -- from CSV only
                  website, domain (normalised), custom jsonb,
                  status (queued|researching|writing|done|fallback|failed|skipped),
                  confidence (high|medium|low), is_holdout bool

domain_research   domain PK, pages jsonb [{url, type, md_hash}],
                  facts jsonb [{id, text, src, tier}],   -- tier: A|B|C|D (see §5)
                  place_id text null,                     -- only Google field we may store
                  researched_at, expires_at (+30 days)

generations       id, lead_id, plan jsonb {angle, pain, move[], cta_type},
                  slot_outputs jsonb, full_email text, subject text,
                  facts_used text[], skill_version text,
                  checks jsonb, judge_scores jsonb, edited_by_user bool, created_at

usage_costs       id, lead_id, step (scrape|extract|write|validate|judge|search|places),
                  model, input_tokens, output_tokens, cached_tokens,
                  provider_units numeric, cost_usd numeric, created_at

skill_versions    version PK, prompt text, rules jsonb, moves jsonb, example_ids int[],
                  status (draft|testing|live|retired), traffic_share int, changelog
eval_runs         id, skill_version, baseline_version, test_set_id, wins, losses, ties,
                  judge_avg, rule_fail_rate, human_picks jsonb, created_at
example_library   id, industry, language, angle, email_text, sends, positive_replies,
                  label (winner|loser), source (own|customer_opt_in)

inboxes           id, workspace_id, email, type (gmail_script|gmail_oauth),
                  sender_key_hash, daily_cap int default 30, warmup_day int,
                  window jsonb {days, start, end, tz}, health (healthy|warming|offline|paused),
                  last_heartbeat_at
sequence_steps    id, campaign_id, step_no, delay_days (working days), kind (personalised|plain),
                  template_body, same_thread bool default true
sends             id, lead_id, step_no, inbox_id, scheduled_for,
                  status (queued|sent|replied|bounced|stopped), gmail_thread_id, sent_at
integrations      id, workspace_id, provider (instantly|smartlead|lemlist),
                  api_key_encrypted, webhook_secret, auto_rules jsonb
suppression       workspace_id, email, domain, reason (unsub|bounce|replied|manual), created_at
```

**Credit flow:** campaign start → `reserve` 1 per lead (+1 Deep, +2 Local). Each success → `capture`. Fallback/cancel → `release`. Stripe webhook → `purchase` (idempotent on `stripe_event_id`). Implement reserve/capture/release as Postgres functions inside transactions so a crashed worker can never double-charge.

---

## 4. The per-lead pipeline (`src/engine/`)

Each lead is its own job. Steps:

1. **Reserve** credits, set lead `queued`.
2. **Cache check:** `domain_research` row not expired → skip to step 5.
3. **Research** (§5).
4. **Extract facts:** Haiku turns page markdown into 3–6 facts as JSON `{id:"F1", text, src, tier}`. Page text is wrapped in clear data tags and treated as **data, never instructions** (prompt-injection defence: strip scripts and hidden elements, ignore any instructions inside page text).
5. **Write:** Sonnet (or Haiku for "Lite") gets: Sales Skill (§6), the template + slot instructions, style rules, facts, role info from the CSV, and up to 3 similar examples. It returns **plan first, then slots**, as JSON (schema in §6).
6. **Validate** (§7). On failure: one rewrite with the reasons. Still failing → fallback line, 0 credits.
7. **Settle:** save the generation, log real token/unit costs in `usage_costs`, capture or release the credit, push a realtime update.

Concurrency: per-workspace cap (e.g. 10 jobs at once) plus a global limiter for Anthropic/Firecrawl rate limits. Retry 429/5xx with exponential backoff. Jobs must be idempotent.

---

## 5. Research sources

**1. Company website. Always on, the core (~$0.003/lead).**
- `map` the domain (1 call), then classify URLs by path keywords, with no AI:
  - about/team: `over-ons, wie-zijn-wij, team, ons-verhaal, about, story, ueber-uns`
  - services: `diensten, behandelingen, werkwijze, services, solutions, what-we-do, leistungen`
  - news/blog: `nieuws, blog, actueel, news, updates, aktuelles, neuigkeiten`
  - careers (bonus hiring signal): `vacatures, werken-bij, careers, jobs, karriere`
  - drop: privacy, cookie, login, cart, tag, category, wp-admin, feeds, files (.pdf etc.)
- Pick **homepage + best about/team + best services + newest news/blog post** (3–4 pages). Scrape as markdown and trim nav and footer.
- 15s timeout per page, respect robots.txt. If unreachable → fallback.

**2. Decision maker. Light, no scraping.**
- Use only CSV fields: name, title, LinkedIn headline. Use them for relevance (which pain fits the role), not as a hook.
- **Deep (+1 credit):** one Firecrawl search `"<full name>" "<company>"`, read the best 1 result. A result is only used if it mentions the company name or domain (name-collision guard). Only public, professional info.

**3. Local (+2 credits): Google reviews.**
- Google Places API (New). Text Search with fields that include reviews (Enterprise + Atmosphere tier, ~$40/1k) or Place Details with reviews (~$25/1k) when a place ID is known. **Field masks set the price**: request only the fields you need.
- Google terms: **do not store review text**, only `place_id`. Use reviews in memory during the job to extract a *theme*, then discard. Attribute review-based facts as "Google reviews" in the UI.
- Auto-suggest Local when most leads look like local businesses.

### Fact tiers (the writer must respect these)
- **A:** company facts from the website. First choice for the opener.
- **B:** review *themes* only. Never quote or name a reviewer, never mention negative reviews.
- **C:** role facts from the CSV. Context, rarely quoted ("Saw your headline…" is banned).
- **D:** public professional mentions from Deep. Only with a confirmed match.
- **Never:** family, health, home address or area, private social media, age, religion, politics, anything from a non-work source. Hard-blocked by the validator.

---

## 6. Sales Skill v1 (writer instructions, versioned in `skill_versions`)

Write the principles in our own words. Don't paste book text. Never mention Hormozi or Girard in emails.

**Layer 1: cold email rules (always win):**
- Personalised slots: opener ≤ 25 words, bridge ≤ 1 sentence (or the slot's `max_words`).
- First line is about them, not us. Plain language, peer tone, more "you" than "we".
- One low-effort CTA (interest or soft question, never "book 30 minutes").
- No flattery about their website, no "I hope this finds you well", "I came across", hype words, exclamation marks, or numbers that aren't in the facts.
- Write in the language of the user's copy.

**Layer 2: persuasion moves (pick 1–2 per email):**
`value_stack` (bigger outcome, more certainty, less time, less effort), `genuine_interest`, `cost_of_inaction`, `proof`, `no_oriented_ask`, `risk_reversal`.

**Layer 3: examples:** up to 3 most similar winners from `example_library` (by industry/language/angle). Seed with my own best-performing emails.

**Layer 4: the customer's input:** copy, slot instructions, style rules, preview feedback. Customer rules beat Layer 2, Layer 1 beats everything.

**Writer output schema (strict JSON):**
```json
{
  "plan": {
    "angle": "F1",
    "pain": "short, in their words",
    "move": ["genuine_interest", "cost_of_inaction"],
    "cta_type": "interest | soft_question"
  },
  "slots": { "opener": "...", "bridge": "..." },
  "facts_used": ["F1", "F2"],
  "skill_version": "1.0"
}
```

---

## 7. Validation & quality

1. **Plan check (code):** moves are from the allowed list, cta_type allowed, every fact ID exists, the angle fact is actually reflected in the opener.
2. **Rule checks (code):** word counts per slot, banned phrases (per language), you/we ratio, ≤ 1 question per slot, no links, no exclamation marks, spam-word list, no tier-✕ content.
3. **AI judge (Haiku, separate call):** scores 1–5 on relevance, specificity, value clarity, CTA effort, sounds human, "would a busy owner reply?", and checks every claim against the facts. Average < 3.5 → one rewrite. Sonnet re-judges a 5% sample.
4. **Test set (later, Quality Lab):** fixed 100 leads. Every new skill version runs on all 100, compared side by side with the previous version by the judge. Only ship if it wins clearly.
5. **Real replies:** every send records `skill_version` + moves. Compare positive reply rate per version/move; A/B by `traffic_share`; optional `holdout_pct` of leads get the plain copy as a baseline.

---

## 8. Sending

### Lane A: Gmail "Sender Sheet" (core ICP, MVP)
- A template Google Sheet with an Apps Script. The customer clicks "Make a copy", menu **FirstLine → Connect**, pastes a per-inbox key, approves Google's permission screen (their own script, so we need no Google verification).
- The script (keep it small, ~300 lines, versioned):
  - time trigger every 5 min
  - `GET /api/sender/next` (key in header) → gets **one** email or "nothing now"
  - step 1: `GmailApp.createDraft(...).send()` to get message/thread IDs. Follow-ups: reply in the same thread
  - `POST /api/sender/report` with `{send_id, status, thread_id}`
  - each run: check tracked threads for a message from someone else → `replied`; check mailer-daemon emails → `bounced`. Only status flags go to FirstLine, never email content
  - writes a log row in the sheet; a "Pause" cell stops everything
  - heartbeat each run; checks its own version and shows "please update" if outdated
- **Scheduler lives on our server**, in `/sender/next`: only hand out an email if the inbox is inside its window, under today's cap, past `nextSendAt` (random 6–14 min gap), and the lead isn't suppressed.
- Defaults: daily cap 30, warm-up 10 → 30 over ~14 days (+2/day), Mon–Fri 08:30–17:00 in the inbox's timezone. Bounces > 3% or script errors → step back the warm-up.
- Stop rules: reply, bounce, "stop/unsubscribe" in reply, manual pause; stop per lead **and** pause other leads at the same domain after a reply.
- Every email gets an opt-out line by default ("Not relevant? Just reply 'no'.").
- Inbox offline (no heartbeat 2h inside window) → mark offline + email the user.
- Limits to know: Apps Script allows 100 recipients/day on free Gmail, 1,500 on Workspace.
- Onboarding tip: recommend a Google Workspace inbox on a **separate domain**, not the main one.

### Lane B: sending tools (bigger senders)
- **CSV export** in the MVP: all columns + `fl_opener`, `fl_bridge`, `fl_ps`, `fl_full_email`, `fl_sources`, `fl_confidence`.
- **API push** later. Instantly first: API **v2** key (v1 is shut down). **Add custom variables to the campaign first** (`POST /api/v2/campaigns/{id}/variables`), then `POST /api/v2/leads/add` in batches of ≤ 1,000 with `custom_variables`, skipping duplicates. Webhooks for replies and bounces. Then Smartlead (`custom_fields`), then Lemlist.

### Charging for sending
Gmail sending is free for FirstLine-personalised emails. Personalised follow-up steps cost 1 credit, plain follow-ups are free.

---

## 9. Pricing & credits

- Credit packs: **Starter 500 = €19, Growth 2,000 = €69, Agency 10,000 = €299** (excl. VAT). Credits never expire. 25 welcome credits after email verification (limited per company domain).
- Add-ons per lead: Deep +1 credit, Local +2 credits.
- Writer tiers: **Pro** (Sonnet writes) is the default. **Lite** (Haiku writes, 2 pages researched) costs the same credits per email but is sold as cheaper volume packs for big senders.
- Economy mode (Batch API, results within hours): cheaper credits later.
- Target real cost: ~€0.010 per email (Pro). Log real costs in `usage_costs` and build an admin margin view.
- Stripe Checkout with iDEAL | Wero + cards, Stripe Tax (EU reverse charge with VAT ID), auto top-up via saved payment method.

---

## 10. Screens (MVP)

1. **Upload leads:** CSV drop, auto column mapping (first_name, company, website, email, title, linkedin_headline, custom), dedupe on email, normalise domains, flag rows with no website, show "≤ N credits" estimate.
2. **Your copy:** subject + body editor. `{{variables}}` = plain mail-merge. `[[SLOT · instruction · max words]]` = AI-written. Style rules, research depth (Standard / +Deep / +Local), speed (Now / Economy).
3. **Preview:** 5 free leads, showing facts with sources and tiers, the email with AI parts highlighted and fact IDs, check ticks, regenerate / edit instruction / 👍👎.
4. **Run:** live progress (Supabase Realtime), done / queued / fallback (free) / credits used, results table, editable.
5. **Send:** choose Gmail (recommended < 100/day) / sending tool / CSV.
6. **Inboxes:** connect Gmail via Sender Sheet (4 steps + key), safety settings, inbox health.
7. **Sequence & replies:** steps with delays, stop rules, sent/replied/bounced/reply rate.
8. **Credits:** packs, auto top-up, ledger history, "Why this price?" (cost × 3).
9. **Admin (me only):** margin per campaign/day, cost drift alerts, Quality Lab (skill versions, test-set wins, judge avg, reply rate per version).

Design: clean and calm. Light background, one accent colour (indigo/blue), Inter font, rounded cards, plenty of whitespace. Desktop first, but usable on mobile.

---

## 11. Legal & safety
- Privacy policy, terms (customer is responsible for lawful outreach; no spam or phishing), DPA template, sub-processor list (Anthropic, Firecrawl, Supabase, Stripe, Google Maps Platform, Resend).
- Auto-delete lead data 30 days after a campaign ends.
- Encrypt stored third-party API keys.
- Abuse: verified signup, limited free credits per domain, one email per `/sender/next` call, admin switch to disable the Sender API per workspace, flag huge lists of personal addresses (gmail/hotmail).

---

## 12. Build phases

Build **one phase at a time**. At the end of each phase: run tests and a typecheck, start the dev server, tell me exactly what to click to try it, and **stop and wait for my OK** before starting the next phase.

**Phase 1: Skeleton + input**
Next.js + Supabase auth (email magic link + Google), workspace on signup, full SQL migration from §3 with RLS and ledger functions, CSV upload + mapping + dedupe + domain normalising, template editor with `{{vars}}` and `[[slots]]` parsing. Unit tests for CSV, domain normalising and template parsing.
✅ I can sign up, upload a CSV, map columns and write a template with slots.

**Phase 2: The engine + preview**
Job queue + worker, page picker (§5), Firecrawl map/scrape, Haiku fact extraction with tiers, Sales Skill v1 writer with plan JSON, validator (plan check + rules + AI judge), fallback, domain cache, cost logging. Preview screen with facts, sources and checks.
✅ I can preview 5 real leads with cited facts and passing checks.

**Phase 3: Gmail sender**
Sender Sheet template + Apps Script (in `/apps-script/`, with setup instructions), `/api/sender/next` + `/api/sender/report` with per-inbox keys, scheduler (window, cap, random gaps, warm-up), reply and bounce detection, stop rules, suppression list, opt-out line.
✅ I can send my own small campaign from my Gmail and replies stop the sequence.

**Phase 4: Sequences + inboxes**
Follow-up steps in the same thread, multiple inboxes with rotation, heartbeat and health, sequence and replies dashboard.
✅ A 3-step sequence runs on its own across 2 inboxes.

**Phase 5: Money + output**
Stripe Checkout (iDEAL + card), webhook → ledger (idempotent), reserve/capture/release wired into the pipeline, credits page, auto top-up, CSV export with all `fl_` columns.
✅ I can buy credits, run 300 leads and see exact credit usage.

**Phase 6: Polish + launch**
Prompt caching, Economy mode (Batch API), admin margin dashboard, Quality Lab v1 (100-lead test set + version comparison), landing page, privacy/terms/DPA pages, Gmail safety tips in onboarding.
✅ Ready for 5–10 beta users.

**Later (V1.5+):** Instantly → Smartlead → Lemlist API push + webhooks; public API + n8n/Make node; team workspaces; Deep and Local add-ons; volume packs; Lite tier; Google-verified one-click "Connect Google" (OAuth); Outlook sender.

---

## 13. Working rules for Claude Code
- Ask me for any API key or account you need **when you need it**, and tell me exactly where to get it. Never invent keys or hard-code secrets.
- Keep business logic in small, pure, tested functions (`src/lib/`, `src/engine/`). UI stays thin.
- Use the exact model IDs `claude-haiku-5-5` and `claude-sonnet-5-5`, and keep them in one config file.
- Log every AI and API call's real cost to `usage_costs`.
- Use database migrations (Supabase CLI), never manual schema changes.
- Commit after each working step with clear messages.
- If something in this spec is unclear or seems wrong, ask before building around it.
