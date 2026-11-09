# FirstLine Sender Sheet

The Google Sheet + Apps Script that sends a FirstLine campaign from your own Gmail account (§8, Lane A).
It runs in **your** Google account, so FirstLine never sees your Gmail password or your emails: the script only
tells FirstLine "sent", "replied", "bounced" or "asked to stop".

## One-time setup (about 5 minutes)

1. **In FirstLine:** Inboxes → **Add Gmail inbox**. Enter the Gmail address you'll send from. Copy the
   **FirstLine address** and the **sender key** it shows (the key is shown once).
2. **In Google Sheets** (signed in as that Gmail account): create a new blank spreadsheet and name it
   "FirstLine Sender".
3. **Extensions → Apps Script.** Delete what's in `Code.gs`, paste the whole [`Code.gs`](Code.gs) from this folder,
   and click **Save** (the disk icon).
4. Close the Apps Script tab and **reload the spreadsheet**. A **FirstLine** menu appears (after a few seconds).
5. **FirstLine → Connect…** Paste the FirstLine address, then the sender key.
6. Google asks for permission ("Google hasn't verified this app" is normal for your own script):
   **Advanced → Go to FirstLine Sender (unsafe) → Allow.** The script needs to send email as you, read the
   threads of emails it sent (for replies and bounces), and call FirstLine.
7. Done. The **FirstLine** tab shows the status; the **Log** tab lists every email sent, reply and bounce.

Run **FirstLine → Connect…** once more after the permission screen if the first attempt stopped there.

## Day to day

- The script runs every 5 minutes. FirstLine decides when to send: only inside your sending window
  (default Mon–Fri 08:30–17:00), with 6–14 minutes between emails, under today's limit (warm-up starts at
  10 a day and grows by 2 each sending day up to 30).
- **Pause:** tick **Pause sending** on the FirstLine tab. Replies are still detected while paused.
- A reply stops that lead and pauses other leads at the same company (you can resume them in FirstLine).
  "Unsubscribe", "stop", or just "no" also adds them to your do-not-contact list. Bounces do too.
- If FirstLine says the script is outdated, paste the latest `Code.gs` again (step 3). Your settings stay.

## Limits to know

- Gmail lets Apps Script send to **100 recipients a day on a free Gmail account** and 1,500 on Google Workspace.
- Tip: use a Google Workspace inbox on a **separate domain** (e.g. `getacme.com` instead of `acme.com`) so your
  main domain's reputation is safe.

## For FirstLine developers

- `Code.gs` is tested in Node with fake Google services: `apps-script/code.test.ts`.
- Bump `FL_VERSION` here **and** `SENDER_SCRIPT_VERSION` in `src/sender/db.ts` together. Raise
  `MIN_SCRIPT_VERSION` only when old scripts must stop sending until updated.
- The reply/stop/bounce patterns come from the server (`src/lib/sender/messages.ts`), so they can change without a
  script update.
