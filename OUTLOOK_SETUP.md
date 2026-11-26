# Outlook / Microsoft 365 setup

FirstLine sends from customers' own Microsoft 365 mailboxes through one multi-tenant Microsoft Entra app that
belongs to FirstLine. You register that app once. Customers then click **Connect Outlook** on the Inboxes page.

Without these settings, local development uses a fake Microsoft (no account needed) and production hides
"Connect Outlook".

## How it works

- **Sign-in:** work and school accounts only (`organizations`). Permissions (delegated): `openid`,
  `offline_access`, `User.Read`, `Mail.Send`, `Mail.ReadBasic`. No `Mail.Read`: FirstLine never reads email text.
- **Consent:** in many organisations only an admin may approve an app from an unverified publisher. The user then
  lands on "Your organisation needs to approve FirstLine" with a link to send to their IT person, and a
  **Check again** button.
- **Tokens:** encrypted (AES-256-GCM, `INTEGRATIONS_ENCRYPTION_KEY`) in `inbox_credentials`, readable only by the
  server. They rotate on every use.
- **Disconnects:** when access ends (admin password reset, revoked, 90 days unused), the inbox becomes
  "Disconnected" and the workspace owner gets one email. A user changing their own password does **not** disconnect
  it.
- **Sending:** the worker sends every minute through the same scheduler as Gmail: caps, warm-up, 6–14 minute gaps,
  window, suppression, opt-out line.
  - Step 1 goes out with `sendMail`; follow-ups are replies in the same conversation.
  - If Microsoft throttles (429), the email waits as long as Microsoft asks; no error is counted.
- **Replies and bounces:** checked every ~10 minutes from message details only (who, subject, conversation, time).
  - Out-of-office replies are ignored.
  - A bounce is recognised from the postmaster's "Undeliverable: …" message. If several emails share that subject,
    it can't be matched and is skipped.

## What you do (once)

Microsoft's portal labels are given in English and Dutch. Dutch labels can differ slightly by version.

### 1. Register the app
1. Go to **entra.microsoft.com** and sign in with your Microsoft 365 work account. A free Microsoft Entra tenant
   is enough; an existing Microsoft 365 business tenant is fine.
2. **Identity → Applications → App registrations → New registration**
   (NL: *Identiteit → Toepassingen → App-registraties → Nieuwe registratie*).
3. **Name:** `FirstLine`.
4. **Supported account types:** *Accounts in any organizational directory (Any Microsoft Entra ID tenant –
   Multitenant)* (NL: *Accounts in elke organisatiemap (elke Microsoft Entra ID-tenant – multitenant)*).
5. **Redirect URI:** platform **Web**, value
   `https://firstline.46-17-99-33.sslip.io/connect/outlook/callback`. Then click **Register** (NL: *Registreren*).
6. Open **Authentication** (NL: *Verificatie*). Under the Web platform, **Add URI** (NL: *URI toevoegen*):
   `https://firstline.46-17-99-33.sslip.io/connect/outlook/admin-done`. Click **Save** (NL: *Opslaan*).
7. On **Overview** (NL: *Overzicht*), copy the **Application (client) ID** (NL: *Toepassings-id (client)*).

### 2. Permissions
1. **API permissions → Add a permission → Microsoft Graph → Delegated permissions**
   (NL: *API-machtigingen → Een machtiging toevoegen → Microsoft Graph → Gedelegeerde machtigingen*).
2. Tick `openid`, `offline_access`, `User.Read`, `Mail.Send`, `Mail.ReadBasic` → **Add permissions**
   (NL: *Machtigingen toevoegen*).
3. Remove anything else that's listed. Only for testing in your own tenant: **Grant admin consent for <your tenant>**
   (NL: *Beheerderstoestemming verlenen voor …*).

### 3. Client secret
1. **Certificates & secrets → Client secrets → New client secret**
   (NL: *Certificaten en geheimen → Clientgeheimen → Nieuw clientgeheim*).
2. Description `FirstLine server`, expiry **24 months** (the maximum). Put a reminder in your calendar a month
   before it expires.
3. Copy the **Value** (NL: *Waarde*), not the "Secret ID". It's shown only once.

### 4. Save both on your computer, then deploy
Run inside `~/code/firstline`, each command on a fresh line. You type the values; nothing is printed:

```bash
bash scripts/set-env.sh MICROSOFT_CLIENT_ID
```

```bash
bash scripts/set-env.sh MICROSOFT_CLIENT_SECRET
```

```bash
npx supabase db push --remote
```

```bash
SSH_KEY=~/.ssh/sbd_hostkey bash deploy/deploy.sh
```

**When you move to your own domain:** add the two redirect URIs with the new address in step 1.5 and 1.6, then
deploy. Keep the old ones until everything works.

## Test with a real mailbox
1. Inboxes → **Connect Outlook**, sign in with a Microsoft 365 work mailbox, and approve. As an admin you approve
   directly; as a normal user you'll see the approval screen and link.
2. Make a small campaign to two addresses you own (one Gmail, one other), start sending from the Outlook inbox, and
   check:
   - both emails arrive and show in Sent Items;
   - the follow-up arrives **in the same thread**;
   - a reply from one address stops its sequence (within ~10 minutes);
   - an email to a non-existent address at a real domain shows as **Bounced**.

   Each check is listed in the report as "needs a real tenant".
3. In Microsoft (My Apps → FirstLine → remove), revoke access. Within a few minutes the inbox shows
   **Disconnected**, and the owner gets an email if Resend is set up.
