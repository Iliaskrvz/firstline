# Bouncer as email-verification sub-processor: drafts for the lawyer (not published)

For your lawyer. Nothing here is on the site and nothing is built yet. Design: `docs/EMAIL-VERIFICATION.md`. It goes live
only when paid mailbox verification is built and switched on.

## 1. What changes

Today FirstLine checks addresses for free on its own servers: format, throwaway domains, role addresses, typos, and
whether the domain has mail servers (DNS). It never contacts a mailbox.

With paid verification switched on **for a campaign, by the customer**, FirstLine sends each lead's email address (and
nothing else: no name, company or email text) to **Bouncer** (company name and seat to confirm from its DPA; it presents itself as EU-based). Bouncer contacts the
recipient's mail server to ask whether the mailbox exists, without sending an email, and answers deliverable / risky /
undeliverable / unknown. FirstLine stores that answer with the lead for 30 days.

What Bouncer says publicly (read 2026-11-26, usebouncer.com/gdpr):
- data is stored only in EU AWS data centres;
- addresses are hashed everywhere in its system except the layer the results are downloaded from;
- results are deleted after 60 days, or earlier on request;
- a Data Processing Agreement is published at usebouncer.com/dpa (to be signed before use).

## 2. Sub-processor list (draft row)

| Sub-processor | Purpose | Data | Location |
|---|---|---|---|
| Bouncer (legal entity: from its DPA) | Checking whether a lead's mailbox exists (only for campaigns where the customer switches it on) | Lead email addresses | EU (AWS EU data centres) |

## 3. Draft text

**Privacy policy, under "Your leads":**
> If you switch on mailbox verification for a campaign, we send the email addresses of that campaign's leads to our
> sub-processor Bouncer (EU), which checks with the recipient's mail server whether the mailbox exists. No email is sent
> and no other data is shared. We keep the result with the lead for 30 days.

**DPA:** add Bouncer to the sub-processor annex; the 14-day notice to existing customers applies before it's used.

## Questions for the lawyer

1. **Legitimate interest:** our customers send B2B cold email under legitimate interest. Does checking whether a lead's
   mailbox exists, through a third party, fit that same basis (purpose: not sending to dead addresses, which protects the
   sender's reputation and avoids bounces), or does it need its own assessment or mention in the customer's own privacy
   notice to leads?
2. Is the 14-day sub-processor notice needed even though verification is off by default and only used by customers who
   switch it on?
3. Bouncer contacts mail servers in other countries (outside the EU) as part of the check. Is that a transfer we need
   to describe, given that only the address is used in the SMTP conversation?
4. Do we need anything beyond Bouncer's published DPA (for example, a signed copy or an audit clause)?
