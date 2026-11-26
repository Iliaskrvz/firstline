# Legal drafts: Microsoft 365 (Outlook) sending — NOT PUBLISHED

For your lawyer. Nothing here is on the site yet. It goes live when Outlook sending is switched on in production
(`MICROSOFT_CLIENT_ID` set). Facts below match the code in `src/sender/microsoft.ts` and `src/sender/outlook.ts`.

## 1. Privacy policy: new section "Sending from Microsoft 365 (Outlook)"

> **Sending from Microsoft 365.** If you connect a Microsoft 365 work or school mailbox, you sign in with Microsoft and
> allow FirstLine to:
> - sign you in and read your basic profile (name, email address) — permission *User.Read*;
> - send email as you — *Mail.Send* — only the emails you queue in FirstLine, at the pace you set;
> - see basic details of messages in your mailbox — *Mail.ReadBasic*: who sent them, the subject, the conversation
>   they belong to and when. FirstLine uses this only to notice when a lead replies or an email bounces, so it can
>   stop that lead's sequence. **FirstLine never reads the text, preview or attachments of any email**: Microsoft's
>   *Mail.ReadBasic* permission doesn't allow it.
>
> FirstLine stores the sign-in tokens Microsoft issues (encrypted with AES-256-GCM, in our database in the EU), the
> identifiers of your organisation and account, and for each email it sends: the recipient, subject, text and the
> Microsoft message and conversation id. It never stores the content of replies.
>
> You can end this access at any time: click *Disconnect* on the Inboxes page (FirstLine deletes the tokens at once),
> or remove FirstLine in your Microsoft account (My Apps), or ask your Microsoft 365 admin to remove it. Access also
> ends when an admin resets your password or when the inbox isn't used for 90 days.
>
> Microsoft is your own email provider, not a sub-processor of FirstLine: your emails are sent and stored by Microsoft
> under your agreement with them.

## 2. DPA: additions

**Annex (description of processing), categories of data:** add
> "For customers who connect a Microsoft 365 mailbox: OAuth tokens (encrypted), tenant and account identifiers;
> per sent email the Microsoft message and conversation identifiers; for received messages only sender address,
> subject, conversation identifier and time, used to detect replies and bounces and not stored beyond the resulting
> status (replied / bounced) of the email concerned."

**Technical and organisational measures:** add
> "Microsoft 365 access uses delegated permissions limited to User.Read, Mail.Send and Mail.ReadBasic (no access to
> message bodies or attachments). Tokens are encrypted at rest with AES-256-GCM using a key held only on the
> application server, are readable only by the server process (database row-level security without user access),
> rotate on every use, and are deleted immediately on disconnect."

**Sub-processors:** no change. Microsoft acts for the customer as their email provider. Point this out explicitly, as
on the sub-processors page for Google (Gmail).

## 3. Questions for the lawyer

1. Is "Microsoft is your own provider, not our sub-processor" the right qualification when FirstLine calls Microsoft
   Graph on the customer's behalf? (Same question as for the Gmail sheet, where Google runs the script.)
2. Do the reply/bounce checks (sender, subject, time of *all* new Inbox messages, matched against FirstLine's own
   conversations and then discarded) need a separate mention or legal basis? FirstLine only keeps the result for its
   own emails.
3. Retention: the delta position (a Microsoft bookmark) and the stored message ids live as long as the inbox/campaign
   data (campaign data: 30 days after the campaign ends). Enough?
