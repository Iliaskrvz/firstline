# Demo video script: upload → preview → send (60–90 seconds)

For the homepage video slot. One take is fine; no music needed. Record the real app at 1440×900,
browser zoom 100%, light mode, with a clean demo workspace (no customer data on screen).

**Before you record**
- Use a demo CSV with about 20 real companies whose websites have news or about pages. Use your own
  colleagues' names and emails, or obviously fake ones like `sanne@example.com`; never real leads' emails.
- Have a short email ready with one `[[opener]]` slot. Connect a Sender Sheet to a test inbox.
- Close notifications. Hide bookmarks. Turn the mouse pointer highlight on if your tool has one.

| Time | On screen | Voice-over (calm, no hype) |
| --- | --- | --- |
| 0:00–0:08 | The campaign list, then click **New campaign**. | "This is FirstLine. I'll take a list of leads to a first sent email in about a minute." |
| 0:08–0:20 | Upload the CSV. The column mapping appears; domains are cleaned, duplicates removed. | "I upload a CSV with names, companies and websites. FirstLine cleans the domains and drops duplicates." |
| 0:20–0:32 | Paste the email. Type `[[opener]]` where the personal line goes. | "I paste the email I'd send anyway, and mark the one spot that should be personal. Everything else stays word for word." |
| 0:32–0:52 | Click **Preview**. Five leads appear. Open one: the facts with their pages, the line with its footnote, the checks it passed. Show one neutral lead marked "0 credits". | "The free preview reads each company's website. Every line shows the fact and the page it came from. If a site has nothing useful, the lead gets a neutral line and costs nothing." |
| 0:52–1:05 | Click **Run** for the rest. Then the Inboxes page: the connected sheet, today's limit. | "If I like it, I run the rest. It sends from my own Gmail, starting slowly, a few minutes apart, during office hours." |
| 1:05–1:20 | The test inbox: the email arrives. Zoom on the opener. End on the homepage with "Personalise 25 leads free". | "That's the first one. 25 emails are free, no card, and credits never expire." |

**After recording**
1. Export as MP4 (H.264), 1080p, under 15 MB. Add burned-in or separate English subtitles (`.vtt`).
2. Put the files in `public/video/` (for example `demo.mp4`, `demo-poster.jpg`, `demo.en.vtt`).
3. In `src/content/proof.ts`, set `DEMO_VIDEO.src`, `poster` and `captions`, and the duration label.
4. Deploy. The video section appears on the homepage (English and Dutch) once `src` is set.

A Dutch version is optional: record the same script in Dutch and ask for a second slot.
