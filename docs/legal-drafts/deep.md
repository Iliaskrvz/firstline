# Draft for the lawyer: Deep research

Status: DRAFT, 2026-11-12. Not published. Placeholders in [brackets].
Deep is built but **switched off**: not shown, not sold, not in the API, until the lawyer has answered the questions below and Anthropic has confirmed in writing that it fits their Usage Policy.

## What Deep does (plain description)

See [deep-description.md](deep-description.md) (the text sent to Anthropic support and the lawyer).

## How it's kept narrow (built in, tested)

- Only the contact's **own professional content tied to their current company**: articles they wrote, talks they gave, podcast appearances, company news naming them.
- One web search per contact (name + company), through Firecrawl. LinkedIn, social media and people-search sites are never searched or read.
- At most 2 pages read. Code checks each page names the person **and** the company before the AI sees it; the AI must also confirm it's the same person. Otherwise nothing is used and nothing is charged ("no confident match").
- At most **2 facts**, each with its source URL shown in the campaign preview. Facts about family, health, age, home, religion or politics are dropped by code even if a page mentions them.
- The facts are used only to write that one email (not the follow-ups). There is **no person summary or profile screen** anywhere.
- Facts are stored only with the lead and **deleted with the lead data** (30 days after the campaign ends). They are never put in the shared website cache and never reused for another workspace.
- Contacts on a workspace's do-not-contact list are **never searched**.

## 1. Sub-processor list: change

| Company | What for | Data | Where |
|---|---|---|---|
| Firecrawl (Mendable Inc.) | Reading public company websites **and, for Deep research, one web search per contact for their own published work** | Company website addresses; for Deep: the contact's name and company as search terms | United States (SCCs) |

Google Maps Platform is **not** a sub-processor (Local research was dropped; Google's EEA terms don't allow that use).

## 2. Privacy policy: new paragraph under "Your leads"

> **Deep research (optional, per campaign).** If our customer turns on Deep research, FirstLine looks for public work by the contact named in their list, tied to the contact's current company: articles they wrote, talks they gave, podcast appearances and company news naming them. We check that it's the same person (name and company) before using anything; if we're not sure, we use nothing. We never use LinkedIn or social media, and never information about family, health, age, home address, religion or political views. At most two facts are used, only to write that one email, and they're deleted with the lead data, 30 days after the campaign ends. Our customer decides to use Deep research and is responsible for telling the people they email where the information came from.

## 3. DPA: changes

- Section 2 "Data and people", add: "With Deep research: up to two public professional facts about the contact (an article they wrote, a talk, a podcast appearance or company news naming them) with the source URL."
- Section 3 "Purpose", add: "With Deep research turned on: one web search for the named contact's own public professional content tied to their current company, and checking it refers to the same person."
- New clause 4.x: "Deep research excludes special categories of personal data (GDPR Art. 9), data about criminal convictions (Art. 10), private life, home address and family, and never uses social networks or people-search services. Results that can't be confidently matched to the contact are discarded. Contacts on the controller's do-not-contact list are not searched."
- Controller obligation (new clause): "The controller has a lawful basis for Deep research on each contact (normally legitimate interest, after a balancing test) and informs the contacts as required by GDPR Art. 14, including the categories of data and their public sources."

## 4. Terms of service: addition to "Your responsibilities"

> If you turn on Deep research, you confirm you have a lawful basis to look up the public work of the people on your list for business outreach, and that you'll tell them where the information came from when you contact them (GDPR Art. 14). Don't use Deep research for any other purpose.

## Questions for the lawyer

1. Is legitimate interest a realistic basis for Deep research in B2B cold outreach in the Netherlands/EU, and what should the balancing test say?
2. Is mentioning the source in the email itself (e.g. "I saw your talk at Packaging Days") enough for Art. 14, or is a fuller notice needed (a link to a privacy page)?
3. FirstLine as processor: is the DPA wording above enough, or should Deep be a separate opt-in addendum?
4. Firecrawl's terms (no GDPR-violating use, no background checks): does storing up to two extracted facts with the lead for at most 30 days after the campaign fit them?

## For Anthropic

Anthropic's Usage Policy (effective 12 November 2026), section "Do Not Compromise Privacy or Identity Rights", bars compiling or enriching personal data from multiple sources to build profiles of individuals for sale, licensing or disclosure to third parties without their awareness and agreement, in furtherance of use prohibited under the policy. It also bars tracking a person's online activities without consent and facilitating spam. The person facts go through Claude, so Deep as a whole needs Anthropic's written confirmation before it's switched on.
