# DeepSeek as AI sub-processor: drafts for the lawyer (not published)

Status: **draft, 2026-11-13.** Nothing here is on the website yet. The live pages (`/privacy`, `/dpa`, `/subprocessors`, from `src/lib/legal.ts`) still name Anthropic. The code can run on DeepSeek (`LLM_PROVIDER=deepseek`), but production should switch only after the steps in "Before switching production" below.

## 1. What changes

FirstLine's AI steps would move from Anthropic (USA) to DeepSeek (China). The AI steps are:
- reading facts from company websites
- writing the personalised lines
- checking them

Anthropic stays in the code as an unused option. The owner made this choice on 2026-11-13.

## 2. Sub-processor list (draft)

Remove:

| Name | Purpose | Data | Location |
|---|---|---|---|
| Anthropic PBC | AI | Company website text, lead first name, company, job title | United States (SCCs) |

Add:

| Name | Purpose | Data | Location |
|---|---|---|---|
| Hangzhou DeepSeek Artificial Intelligence Co., Ltd. | AI: reading facts from public company websites, writing and checking the personalised lines | Company name, job title, public company website text, the customer's own email copy and style rules. **Never** the lead's email address, first name, last name or LinkedIn URL. | People's Republic of China ([safeguard: see §5]) |

DeepSeek's EU representative (GDPR Art. 27): Prighter Group, rep_deepseek@prighter.com, as named in DeepSeek's privacy policy.

Note: the current list says Anthropic receives the lead's **first name**. With the new data-minimisation rule, no provider receives it any more. That holds for Anthropic too, if the owner ever switches back.

## 3. What we send to DeepSeek, and what we don't

This is enforced in code and tested: `src/engine/privacy.ts`, and `src/engine/llm-deepseek.test.ts`, which fails if any personal field appears in a request.

**Sent:**
- the lead's company name and job title
- text of the company's public website pages (homepage, about, services, news)
- the facts extracted from that text
- the customer's email template and style rules
- the generated lines, for checking

**Never sent:**
- the lead's email address, first name, last name and LinkedIn URL
- any email address or LinkedIn URL in the website text. These are replaced with "[email]" / "[link]" before sending.
- the lead's name, if it appears on the company's website (for example on a team page). It is replaced with "[contact]".

The model refers to the person neutrally. FirstLine's own software fills in `{{first_name}}` and other variables after the AI step, on our servers.

**Not available with DeepSeek:** "Deep" research, which searches a named contact's public work. It needs the contact's name, so it can't run under this rule. It also stays off for other reasons; see `deep.md`.

**Remaining personal data:** a job title together with a company name can identify a person at a small company (for example "Founder at Acme Studio"). We treat this as personal data and assume the transfer rules apply.

## 4. Draft text

### Privacy policy (new paragraph under "Who receives data")

> To write the personalised lines, FirstLine uses an AI service from Hangzhou DeepSeek Artificial Intelligence Co., Ltd. in the People's Republic of China. We send it only what's needed: the company name, the contact's job title, text from the company's public website, and our customer's own email text. We never send the contact's email address, first name, last name or LinkedIn profile; our software adds the name after the AI step. China has no EU adequacy decision. The transfer is covered by [the European Commission's Standard Contractual Clauses (Module 3, processor to processor), with additional measures described in our transfer impact assessment]. [Placeholder: retention and training terms once confirmed in writing by DeepSeek.]

### DPA (§5 sub-processors and transfers, replacing the transfer sentence)

> Transfers to sub-processors outside the EEA are covered by the European Commission's Standard Contractual Clauses or the EU-US Data Privacy Framework. For the AI sub-processor in the People's Republic of China, the processor sends only the data listed in Annex [X] (no email addresses, names or LinkedIn URLs of data subjects), relies on [Standard Contractual Clauses, Module 3], and has carried out a transfer impact assessment, available to the controller on request.

### DPA Annex [X] (new): data sent to the AI sub-processor

The "Sent" and "Never sent" lists from §3.

### Customer notice (the DPA requires at least 14 days' notice of a new sub-processor; customers may object)

> On [date + 14 days], FirstLine will replace Anthropic (USA) with DeepSeek (China) as the AI service that writes the personalised lines. DeepSeek will receive company names, job titles, public website text and your email text, but never your leads' email addresses, names or LinkedIn profiles. If you object, reply to this email before [date]; [what happens on objection, e.g. the contract can be ended and unused credits refunded].

## 5. The safeguard the lawyer needs to judge

China has no adequacy decision, so an Art. 46 GDPR safeguard is needed.

What DeepSeek's own documents say (read 2026-11-13: Open Platform Terms of Service, effective 2026-04-29; Terms of Use, updated 2026-03-27; Privacy Policy, updated 2026-02-10):

- **Location:** they say they "collect, process and store" personal data in the People's Republic of China. Group companies in unnamed countries may also process it.
- **No DPA or SCCs published.** We found no data processing agreement, addendum or Standard Contractual Clauses in their public pages. The privacy policy says only that they'll use "appropriate safeguards" where required, without naming one. Platform pages behind login weren't readable. Contacts: privacy@deepseek.com, api-service@deepseek.com.
- **Training on inputs:**
  - Their Terms of Use (s.4.3) allow using inputs and outputs to improve and develop the services, after de-identification.
  - The opt-out described is a consumer app setting. The API terms don't mention an opt-out for API data.
  - **We need written confirmation that API inputs aren't used for training, or a contractual opt-out.**
- **Retention:** no period for API data. Their privacy policy says account data, inputs and payment data are kept "for as long as you have an account".
- **Governing law:** People's Republic of China (mainland). Venue: courts at DeepSeek's registered office (Hangzhou).
- **Liability:** capped at the fees paid in the last 12 months (Open Platform ToS s.7.3).
- **The developer (us) is the controller towards end users** (Open Platform ToS s.3.3, s.5.5). We must inform them and have a legal basis.
- **AI labelling:** "clearly disclose to your end users that the Output content is generated by AI" (s.8.1). Our customers know the lines are AI-written. **Question:** does this reach the email recipients?

**Questions for the lawyer:**
1. Can SCCs (Module 3) be concluded with DeepSeek at all, given they offer none publicly? If not, is there any Art. 46/49 basis for this transfer?
2. Transfer impact assessment:
   - Does Chinese law (National Intelligence Law Art. 7, Data Security Law, PIPL) allow effective protection for this data?
   - Is our data minimisation (no names or emails; company, job title and public website text only) a sufficient supplementary measure?
3. Is "company + job title" still personal data here, and does that change the answer?
4. Training on API inputs: is written confirmation enough, or is a contract needed?
5. Does the AI-labelling clause (s.8.1) require anything in the cold emails our customers send?
6. Our customers are controllers of their leads' data. Do they need to update their own privacy notices (Art. 14 information to recipients) to mention a transfer to China?
7. Is the 14-day notice in our DPA enough, and what should we offer customers who object?

## 6. DeepSeek's terms on our use case

**Cold-email personalisation:**
- Nothing in the Open Platform ToS, Terms of Use or Privacy Policy mentions spam, bulk email, cold outreach, lead generation or marketing automation.
- The general rules apply:
  - no use that is illegal or infringes third parties' rights (Terms of Use s.3.6(1); Open Platform ToS s.3.1)
  - no harassing or distressing content (s.3.4)
  - the developer is responsible for its end users and downstream use (s.3.2), and must name the AI as generator to its end users (s.8.1)
  - no use of DeepSeek's name or logo in promotion (s.5.3)
- **Reading:** allowed, provided the outreach is lawful (GDPR legitimate interest, ePrivacy rules for B2B email in the target countries). That's already a condition in our own terms.

**Deep (searching a named person's public work):**
- No rule names searching for or identifying individuals.
- The closest rules:
  - the developer must inform people and have a legal basis (s.3.3)
  - get consent before sharing another person's personal information (Terms of Use s.1.6, about shared links)
  - decisions with a material impact on people need human review (s.5.4)
- Deep would also break our own rule that names never go to DeepSeek.
- **Deep stays off. With DeepSeek it can't be switched on at all.**

## 7. Before switching production

1. Lawyer's answers to §5, including whether the transfer can be made lawful at all.
2. DeepSeek's written answers:
   - SCCs or a DPA
   - no training on API data
   - retention period
3. Transfer impact assessment written and kept.
4. Update `/privacy`, `/dpa` (with the new annex) and `/subprocessors` (`src/lib/legal.ts`) with the approved text.
5. Notify customers at least 14 days before the switch.
6. Then set `LLM_PROVIDER=deepseek` on the server and deploy.
