# Real content to collect

Everything below has a slot on the site already, hidden until you fill it in. Rule for all of it: only
real material, with written permission from the person or company. Nothing made up, nothing "adapted".

## 1. 3–5 quotes from beta users → `src/content/proof.ts` (`TESTIMONIALS`)

- [ ] Give 5–10 people free credits and ask them to run one real campaign.
- [ ] After their first replies come in, ask: *"What did you notice compared to how you did this before?"*
      Take the answer as they wrote it. Fix typos only.
- [ ] Get a written OK (an email is enough) to show the quote, their name, role and company.
- [ ] Optional: a square photo (at least 200×200) in `public/proof/`, also with permission.
- [ ] Fill in the entry, set `placeholder: false`. Dutch quotes stay Dutch (`language: "nl"`).

## 2. One case study from your own campaigns → `src/content/proof.ts` (`CASE_STUDIES`)

- [ ] Pick one campaign of your own with at least 200 emails sent.
- [ ] Reply rate before: your last comparable campaign without FirstLine (same kind of leads, same offer).
      Write down how many emails it's based on.
- [ ] Reply rate with FirstLine, and its number of emails.
- [ ] Three numbers that tell the story (e.g. emails sent, replies, meetings booked).
- [ ] One sentence in your own words for the quote, or a client's with their permission.
- [ ] Fill in, set `placeholder: false`.

## 3. 10–15 example openers → `src/content/examples.ts` (`EXAMPLES`)

- [ ] From real campaigns, 2–3 per industry (bakeries/food, agencies, SaaS, accountants, construction, recruitment, or your own).
- [ ] For each: the website (a real one only with the company's permission; otherwise write it like `bakery-in-utrecht.example`),
      what the sender sells, the opener word for word, and the facts with the page they came from.
- [ ] Remove anything that identifies the lead person.
- [ ] Set `placeholder: false` on each. Delete the placeholder entries you don't replace.

## 4. Demo video (60–90 seconds) → `src/content/proof.ts` (`DEMO_VIDEO`)

- [ ] Record it with the script in `docs/marketing/demo-video-script.md`.
- [ ] Put the MP4 (and optional poster and subtitles) in `public/video/`, set `src`.

## 5. Customer logos (optional) → `src/content/proof.ts` (`CUSTOMER_LOGOS`)

- [ ] Only customers who said yes in writing. Their official logo file (SVG or PNG) in `public/proof/logos/`.

## Turning it on

1. Set `SHOW_PROOF` to `1`: `bash scripts/set-env.sh SHOW_PROOF`.
2. For the live counter, also set `PROOF_COUNTER_MIN` (for example `1000`): the line appears once
   FirstLine has personalised at least that many emails.
3. Deploy. Placeholders are never shown in production, even with `SHOW_PROOF=1`.

To check the layout first on your own computer: run the app locally with `SHOW_PROOF=preview`.
