import { GMAIL_FREE_DAILY_LIMIT, SAFE_DAILY_PER_INBOX, WORKSPACE_DAILY_LIMIT } from "@/lib/sender/safety";

const TIPS: { title: string; text: string }[] = [
  { title: "Use a separate domain", text: "Send cold email from a Google Workspace inbox on a second domain (like getacme.com), not your main one. If something goes wrong, your normal email stays safe." },
  { title: "Set up SPF, DKIM and DMARC", text: "Add these three DNS records for the sending domain (Google Workspace admin › Apps › Gmail › Authenticate email). Without them, mail lands in spam." },
  { title: "Let it warm up", text: "FirstLine starts each new inbox at 10 emails a day and adds 2 a day up to your limit. Give a brand-new domain about two weeks before real volume." },
  { title: `Stay under ${SAFE_DAILY_PER_INBOX} a day per inbox`, text: `Google allows ${GMAIL_FREE_DAILY_LIMIT} recipients a day from a script on free Gmail and ${WORKSPACE_DAILY_LIMIT.toLocaleString("en-US")} on Workspace, but cold email is safest at 30 to ${SAFE_DAILY_PER_INBOX}. To send more, add inboxes: FirstLine rotates between them.` },
  { title: "Keep bounces low", text: "Only upload checked email addresses. FirstLine slows an inbox down when more than 3% bounce." },
  { title: "Write like a person", text: "Plain text, one link at most, no attachments. Keep the opt-out line: an easy “no” beats a spam report." },
];

export function SafetyTips({ open }: { open: boolean }) {
  return (
    <details open={open} className="group rounded-xl border border-indigo-100 bg-indigo-50/60 p-5 text-sm text-slate-700">
      <summary className="cursor-pointer list-none font-semibold text-slate-900">
        <span className="mr-2 inline-block transition group-open:rotate-90">›</span>
        Gmail safety tips: protect your domain before you send
      </summary>
      <ol className="mt-4 grid gap-4 sm:grid-cols-2">
        {TIPS.map((t, i) => (
          <li key={t.title} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">{i + 1}</span>
            <div>
              <p className="font-medium text-slate-900">{t.title}</p>
              <p className="mt-1 text-slate-600">{t.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
