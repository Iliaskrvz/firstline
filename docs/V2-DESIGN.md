# FirstLine V2: design (not built)

Written 2026-11-12, after V1.5 (Phases 7–11). Design only: nothing here is built yet. Each part lists prerequisites, real costs, open decisions and a phase plan, and how it builds on what V1.5 already has. External rules were checked on 2026-11-12 (sources at the end); items marked *(unconfirmed)* need a second look before building.

V1.5 pieces these build on:
- **Sending:** the Gmail Sender Sheet (Apps Script in the customer's own Google account) and the `SendingTool` adapter interface for Instantly, Smartlead and Lemlist (`src/integrations/`). A new sender (Google OAuth, Microsoft Graph) is one more sender behind the same scheduler (`/api/sender/next` logic) and the same `sends` table.
- **Outcomes:** one row per email that left FirstLine (`outcomes`: channel, skill version, writer, slot types, fact tiers, status; no personal data, kept after the 30-day deletion), and status flags from webhooks, polling and the Sender Sheet.
- **Workspaces and roles:** owner/admin/member, invites, the activity log, credits per workspace, API keys per workspace.

---

## 1. "Connect Google": one-click Gmail sending with OAuth

Today a customer copies a Google Sheet with a small script into their own account (4 steps plus a key). One click would remove most of the setup friction.

### What Google requires (checked 2026-11-12)
- **`gmail.send` is a *sensitive* scope.** Sending only needs Google's normal app verification, which has no fee stated *(unconfirmed)* and is "up to 10 days" for the scope review. It requires:
  - a verified domain (Search Console) for the app's homepage and privacy policy, with the privacy policy on the same domain;
  - a public homepage that describes the app (not just a login page);
  - an unlisted YouTube demo video showing the consent screen, the client ID and each scope in use;
  - a written justification per scope.
- **Reading mail to see replies needs a *restricted* scope:** `gmail.readonly`, `gmail.modify` and `gmail.metadata` are all restricted, even metadata only. Restricted scopes need a **CASA security assessment** by an authorised lab (Assurance Level AL1 or AL2, chosen by Google), **renewed every 12 months**. The review takes "several weeks". Lab prices aren't published *(unconfirmed: get quotes from e.g. TAC Security, Leviathan, NCC Group, Bishop Fox)*.
- **Before verification:** at most 100 users in total, behind an "unverified app" warning screen.
- **Limited Use rules** apply to both kinds of scope: Gmail data may only be used for the user-facing feature, never for ads or model training. The privacy policy must say so.
- **⚠ Cold email risk:** Google's Gmail API policy lists "applications that distribute spam or unsolicited commercial mail" as prohibited. It allows bulk commercial mail "as long as the user consented to receive emails". The policy doesn't name cold email, but a reviewer could reject FirstLine on this, and the Sender Sheet doesn't have this exposure in the same way: it's the customer's own script. *(Unconfirmed how Google treats B2B cold outreach in review: ask Google, or the lawyer.)*

### Two options

| | A. Send-only OAuth (recommended first) | B. Full OAuth + CASA |
|---|---|---|
| Scopes | `gmail.send` (+ `openid email`) | `gmail.send` + `gmail.readonly` (or `gmail.modify`) |
| Google review | sensitive-scope verification | restricted-scope verification + CASA lab assessment |
| Yearly | nothing extra | CASA re-assessment every 12 months |
| Cost | domain, video, our time (≈ 2–3 days) | the same + lab fees *(unconfirmed; quotes needed)* + more security work |
| Replies and bounces | still detected by the Sender Sheet's script (read-only, in the customer's account), or the customer keeps the script running only for that | detected by FirstLine directly |
| Setup for the customer | one click for sending; the sheet still needed for reply detection | one click for everything |

Option A halves the setup but doesn't remove the sheet. A middle way: replies detected with the script (customer's own authorisation, no CASA), sending through OAuth. Option B is the real "one click", and it's a yearly cost and security process.

### Prerequisites
- **The final brand and domain.** Google verifies a domain and a homepage, and "FirstLine" is also used by another company (firstline.sh; they hold `n8n-nodes-firstline` on npm). The verified brand name shows on Google's consent screen, so decide the brand before applying.
- A privacy policy on that domain that covers Google user data and the Limited Use disclosure (the current one doesn't yet).
- A Google Cloud project owned by the business, with the OAuth consent screen set to "External".

### Real costs
- Option A: no fee found; about 2–3 days of work plus the review wait.
- Option B: the same, plus a CASA lab assessment every year (price unknown until quoted), plus fixing what the lab finds.
- Running cost: zero per email (Gmail API calls are free; quota is per user).

### Open decisions
1. Brand and domain (blocks both options).
2. Option A or B (or A first, B later).
3. Whether to ask Google up front about cold outreach, before building.

### Phase plan
1. **V2.1 Brand and verification prep:** domain, homepage, privacy policy with Google data section, consent-screen setup, demo video. Submit for sensitive-scope verification (Option A).
2. **V2.2 OAuth sender:** a new sender type `gmail_oauth` (the `inboxes.type` column already allows it). Store refresh tokens encrypted (`secret-box`, like integration keys). Send through the Gmail API from the worker under the same scheduler, warm-up, caps and stop rules. Same-thread follow-ups via `threadId`. Reply detection stays in the Sender Sheet script for now.
3. **V2.3 (only if Option B):** CASA assessment, restricted scope for reply detection, then retire the script for OAuth inboxes.

---

## 2. Outlook / Microsoft 365 sender (Microsoft Graph)

### What Microsoft requires (checked 2026-11-12)
- **Permissions (delegated):** `Mail.Send` to send, and `Mail.ReadBasic` or `Mail.Read` for replies. Microsoft marks none of these as admin-only, and refresh tokens last about 90 days. Whether `Mail.ReadBasic` returns the headers or `conversationId` needed to match replies is *(unconfirmed)*.
- **Publisher verification decides who can connect.** Unverified multi-tenant apps (registered after November 2020) asking for more than basic sign-in get a "risky" warning and are stepped up to admin consent in other companies' tenants. Many tenants also only allow user consent for verified publishers. So without verification, most business users can't connect without asking their IT admin.
- **Publisher verification itself is free**, but needs:
  - a Microsoft AI Cloud Partner Program account (Partner One ID, the partner global account);
  - the app registered in a Microsoft Entra work tenant (not a personal Microsoft account);
  - a publisher domain verified in that tenant;
  - MFA.
- **The partner account needs business verification:** "legally registered with an active registration at the stated address", business documents, and an employment check of the contact. Whether a Dutch *eenmanszaak* with a KvK registration passes is *(unconfirmed)*; a BV certainly can.
- **Personal accounts** (outlook.com, hotmail) are supported by the same permissions. Consumer sending limits aren't documented on Microsoft Learn *(unconfirmed)*.
- **Sending limits (Exchange Online):**
  - 10,000 recipients per user per day, 30 messages per minute, and a tenant-wide daily cap on external recipients;
  - trial tenants: 5,000 external recipients per day;
  - `*.onmicrosoft.com` addresses: 100 external recipients per day.
- **⚠ Microsoft's own warning:** "Exchange Online isn't suited to accommodate bulk-mailing scenarios." Its recipient limits exist "to discourage the delivery of unsolicited bulk messages". Low-volume, personalised B2B outreach (30–50 a day per inbox, as FirstLine already caps) fits inside the limits, but the risk is the same as Gmail's.
- **Microsoft 365 Certification / Publisher Attestation:** optional for a Graph mail app; only verification matters for consent.

### What you'd need
- A registered business with documents for Partner Center (a BV is safest; an *eenmanszaak* to be confirmed).
- A Microsoft 365 business tenant (from about €6 per user per month for Business Basic) with the brand domain verified.
- A Partner Center (AI Cloud Partner Program) account: free to join; a paid membership isn't needed for verification.
- The brand decision (the publisher domain shows on the consent screen).

### Real costs
- Verification: free. A Microsoft 365 tenant: about €6 per month for one licence. Our time: about 3–4 days to build.
- Per email: zero (Graph calls are free; throttling is 10,000 requests per 10 minutes per mailbox).

### Open decisions
1. Legal form for Partner Center (BV or *eenmanszaak*).
2. Personal outlook.com accounts too, or Microsoft 365 business accounts only (recommended: business only, as consumer limits are unclear).
3. `Mail.ReadBasic` vs `Mail.Read` for reply detection (smallest that works).

### Phase plan
1. **V2.4 Partner and tenant setup:** business verification, tenant, domain, app registration, publisher verification.
2. **V2.5 Graph sender:** sender type `outlook_graph`; tokens encrypted; send with `sendMail` and follow-ups as replies in the same conversation; reply and bounce detection by polling the mailbox (or Graph change notifications) for messages in the conversation. Same scheduler, caps, warm-up and stop rules as Gmail. Health and heartbeat as for the Sender Sheet.

---

## 3. Agency layer: client workspaces and white-label

Agencies run outreach for many clients. They want one bill, separate client data, and their own brand.

### Design
- **Structure:** an *agency workspace* (`workspaces.kind = 'agency'`) with *client workspaces* (`workspaces.parent_id`).
  - Agency owners and admins can open every client workspace (an implicit admin role, checked by RLS through a `is_agency_admin(ws)` function next to `is_workspace_member`).
  - Client users (if invited) see only their own workspace.
- **Credits:** the agency buys credits; client workspaces get credits allocated from the agency's pool.
  - New ledger types `transfer_out` (agency) and `transfer_in` (client), written as one pair in one transaction, idempotent on a transfer id. The ledger stays append-only and every balance stays a sum.
  - Optional per-client monthly cap: when a client runs out, the agency is asked to top it up.
  - Lite credits transfer as Lite.
- **Reporting:** usage and reply rates per client from `outcomes` (already per workspace and campaign), plus a per-client CSV for invoicing.
- **White-label:**
  - **Logo, colours, app name:** a `branding` row per agency, applied to the app shell, login page and invite emails.
  - **Custom domain** (e.g. `outreach.agency.com`): a CNAME to our server. Caddy's *on-demand TLS* issues certificates only for domains listed in a `custom_domains` table, checked by an "ask" endpoint, so no one can make us issue certificates for random domains. The domain decides the branding before login.
  - **Hidden FirstLine branding:** no FirstLine name in the app, emails or the Sender Sheet. The legal pages stay FirstLine's, since we remain the processor, or move to the agency's own pages under its DPA.
  - **Branded emails:** invites and alerts sent from the agency's domain through Resend, with the agency verifying that domain's DNS.
  - **The Sender Sheet:** a copy with the agency's name. The script stays the same.
- **API and integrations:** API keys and Instantly/Smartlead/Lemlist connections per client workspace (already per workspace), so an agency can connect each client's own tools.
- **Legal:**
  - The agency is the controller for its clients' leads (or a processor for them, with FirstLine as a sub-processor).
  - The DPA needs an agency version that allows sub-processing chains.

### Prerequisites
- Phase 10 teams (done).
- A decision on the agency's legal role, and the lawyer's review of the agency DPA.
- For custom domains: Caddy on-demand TLS on the VPS (supported, needs config) and a rate limit on certificate issuance.

### Real costs
- **Hosting:** per agency, nothing extra at first. Certificates are free (Let's Encrypt); Resend domains are free within the plan.
- **Build:** about 2–3 weeks:
  - structure and credits: 1 week
  - white-label: 1 week
  - reporting and DPA changes: a few days

### Open decisions
1. **Pricing:** a monthly fee for white-label (custom domain and hidden branding), or included in agency packs?
2. Can client users log in at all, or only the agency's own staff?
3. **Credit allocation:** fixed transfers, or a shared pool with per-client caps?
4. **Legal role:** is the agency the controller or a processor for its clients?

### Phase plan
1. **V2.6** Agency and client workspaces, RLS, the switcher grouped by agency, credit transfers, per-client reporting.
2. **V2.7** White-label: branding, custom domains (Caddy on-demand TLS with an allow-list), branded emails, hidden FirstLine branding, the agency DPA.

---

## 4. Reply-rate feedback loop

Learn which kinds of personalisation get replies, and only later feed that back into the writer.

### Data (V1.5 groundwork)
- **Outcome rows:** `outcomes` holds one row per email: channel, skill version, writer, slot types, fact tiers, and its status (sent, replied, bounced, unsubscribed). No personal data; kept after leads are deleted.
- **Opener features** come from the generation: plan angle, moves, CTA type, fact tier and page type of the fact used, word counts, language. **Add them to `outcomes` when the email leaves FirstLine**, because the generation is deleted with the lead after 30 days.
- **Imports:**
  - **Gmail:** the Sender Sheet already reports replies, bounces and "stop" (unsubscribe).
  - **Sending tools:** webhooks and polling report sent, replied, bounced and unsubscribed. Their **own reply labels** give positive vs negative without reading reply text:
    - Instantly: `lead_interested` / `lead_not_interested` / `lead_meeting_booked` events and `lt_interest_status`;
    - Smartlead: `LEAD_CATEGORY_UPDATED` categories;
    - Lemlist: `emailsInterested` / `emailsNotInterested`.
  - **CSV stats import** for tools without an API: email + status (+ optional label), matched to outcome rows while the lead still exists (30 days), then dropped.
- **Gmail positive vs negative:** we don't read reply bodies. Options: the customer labels replies 👍/👎 on the Replies page, or no label (replies only).

### Rules for drawing conclusions
- **Replies only:** opens are unreliable (Apple Mail Privacy Protection, image blocking) and aren't tracked.
- **Holdouts:** `campaigns.holdout_pct` already exists (a share of leads get the fallback line); that's the baseline for "does personalisation help at all".
- **Minimum sample before any conclusion:**
  - at least **300 sent emails per variant and at least 15 replies in total**;
  - a two-proportion test at 95% confidence (or a Bayesian probability above 95% that one variant is better);
  - until then the Quality Lab says "too early".
- **Comparisons:** per variant, within the same language and the same type of sender (Gmail vs sending tools differ in deliverability), never mixing campaigns with very different offers without adjusting.
- **Pitfalls:**
  - Reply rate depends far more on the offer, the list and deliverability than on the opener.
  - So compare *within* campaigns (A/B on the opener only) before comparing across them.

### Phase plan
1. **V2.8 Measure:**
   - opener features on outcome rows;
   - reply labels from the three tools;
   - a CSV stats import;
   - 👍/👎 on the Replies page;
   - the Quality Lab's reply-rate view shows variants with confidence and "too early".
2. **V2.9 Experiment:** an A/B option per campaign (two skill versions or two angle rules, split 50/50), with results in the Lab once the minimum sample is reached.
3. **V2.10 Learn:** only after several clear wins, change the skill (a new version through the existing Quality Lab test set and ship rule), never automatically.

### Real costs
Almost nothing to run (database rows, polling we already do). Build: about 1–2 weeks for V2.8–V2.9.

### Open decisions
1. 👍/👎 labels on Gmail replies: yes or no.
2. A/B tests on by default for big campaigns, or opt-in.
3. Should the minimum sample be stricter (e.g. 500 per variant)?

---

## Suggested order

1. **Brand and domain decision.** It blocks Google and Microsoft verification and the n8n/Make listings.
2. **Reply-rate loop (V2.8–V2.9):** cheap, no outside approval, and it makes every later decision better.
3. **Google send-only OAuth (V2.1–V2.2),** after asking Google (or the lawyer) about cold outreach under the Gmail API policy.
4. **Agency layer (V2.6–V2.7),** when there are agency customers asking for it.
5. **Microsoft Graph (V2.4–V2.5),** when enough customers use Microsoft 365, and once the business can pass Partner Center verification.
6. **CASA (V2.3)** only if Option A's remaining setup turns out to cost real conversions.

## Sources (read 2026-11-12)
- **Google:**
  - Gmail API scopes: developers.google.com/gmail/api/auth/scopes
  - sensitive- and restricted-scope verification: developers.google.com/identity/protocols/oauth2/production-readiness/
  - unverified apps: support.google.com/cloud/answer/7454865
  - security assessment: support.google.com/cloud/answer/13465431
  - CASA tiering: appdefensealliance.dev/casa/casa-tiering
  - authorised labs: appdefensealliance.org/certification/authorized-labs
  - Gmail API policy: developers.google.com/gmail/api/policy
  - user data policy: developers.google.com/terms/api-services-user-data-policy
  - sender guidelines: support.google.com/mail/answer/81126
- **Microsoft:**
  - publisher verification: learn.microsoft.com/entra/identity-platform/publisher-verification-overview
  - user consent: learn.microsoft.com/entra/identity/enterprise-apps/configure-user-consent
  - risk-based step-up consent: learn.microsoft.com/entra/identity/enterprise-apps/configure-risk-based-step-up-consent
  - Graph permissions: learn.microsoft.com/graph/permissions-reference
  - sendMail: learn.microsoft.com/graph/api/user-sendmail
  - throttling: learn.microsoft.com/graph/throttling-limits
  - Exchange Online limits: learn.microsoft.com/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits
  - Partner Center business verification: learn.microsoft.com/partner-center/enroll/understand-the-verification-process
  - Publisher Attestation: learn.microsoft.com/microsoft-365-app-certification/docs/attestation
