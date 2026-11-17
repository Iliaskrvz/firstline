# Legal drafts from the marketing work (not published)

For your lawyer. Nothing here is live. Each part says what turns it on.

## 1. Plausible Analytics (before setting `PLAUSIBLE_SCRIPT_URL`)

Plausible becomes a new sub-processor for website visitors. Your sub-processor page promises 14 days'
notice before a new one starts, so add it there at least 14 days before you switch analytics on.

**Sub-processors table** (`src/lib/legal.ts`, `SUBPROCESSORS`), suggested row:

| Company | What for | Data | Where |
| --- | --- | --- | --- |
| Plausible Insights OÜ | Website statistics without cookies | Pages visited, referrer, browser, country; the IP address is only used to make a daily anonymous count and is not stored | EU |

Check the exact company name and address on plausible.io/privacy before publishing.

**Privacy policy, new paragraph** (suggested):

> *Website statistics.* We count visits to our website with Plausible Analytics. It sets no cookies and
> stores nothing on your device. It records which pages are visited, where visitors came from, their
> browser and country, and a few events (a homepage demo was used, an account was created, a first
> campaign was created, a first purchase was made), never your name, email address or the websites you
> enter. Visitors can't be recognised across days. The data is processed and stored in the EU.

## 2. Homepage demo and contact form (already live once batches 3–4 are deployed)

**Privacy policy, add to "What we store and for how long"** (suggested):

> - Homepage demo: the website address you enter, the optional line about what you sell, and a scrambled
>   (hashed) form of your IP address to enforce the daily limit. Deleted after 30 days.
> - Contact requests from the agencies page: your name, email, company, volume and message, to answer
>   you. Deleted after 180 days. They are emailed to us through Resend.

## 3. Reselling inside client systems

The automation-builders page says builders can use FirstLine inside the systems they build for clients.
The terms don't say this yet. Suggested line under "What FirstLine does":

> You may use FirstLine to deliver services to your own clients, including inside systems you build for
> them. You remain our customer and are responsible for your clients' use as if it were your own.

## 4. Refund of unused credits (only if you set `REFUND_OFFER=1`)

The clause is already in the code and appears in the terms, under "Credits and payment", only when
the switch is on (`src/content/refund.ts`):

> Unused credits from a purchase can be refunded within 30 days of that purchase. Ask us by email; we
> refund the unused credits of that pack at the price you paid, through our payment provider, and remove
> them from your balance. Credits already used are not refunded.

How a refund works today: you refund the order in Polar. /admin then lists it under "Refunds in Polar",
because the credits are not taken back automatically. Remove the unused credits by hand.
