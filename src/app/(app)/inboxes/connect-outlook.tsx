"use client";

// "Connect Outlook": sign in with a Microsoft 365 work account. The browser's timezone becomes the
// inbox's sending window timezone (changeable later, like Gmail inboxes).
import { buttonClass } from "@/components/ui";

export function ConnectOutlook({ available }: { available: boolean }) {
  return (
    <div className="space-y-3 text-sm">
      <h2 className="text-base font-semibold text-slate-900">Connect Outlook (Microsoft 365)</h2>
      <p className="text-slate-600">
        Sign in with your Microsoft 365 work account. FirstLine then sends from your own mailbox, with the same safe limits as Gmail. It sees who replied and
        the subject, never the text of your emails. Personal outlook.com and hotmail.com accounts can&apos;t be connected.
      </p>
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Tip: use a mailbox on a separate sending domain, not your main business domain. In some organisations an admin has to approve FirstLine once; we&apos;ll show
        you the link to send them.
      </p>
      {available ? (
        // A plain GET form: the start route sends the browser on to Microsoft's sign-in.
        <form
          action="/connect/outlook/start"
          method="get"
          onSubmit={(e) => {
            (e.currentTarget.elements.namedItem("tz") as HTMLInputElement).value = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Amsterdam";
          }}
        >
          <input type="hidden" name="tz" defaultValue="Europe/Amsterdam" />
          <button type="submit" className={buttonClass("primary")}>
            Connect Outlook
          </button>
        </form>
      ) : (
        <p className="text-xs text-amber-800">Outlook isn&apos;t set up on this server yet (MICROSOFT_CLIENT_ID).</p>
      )}
    </div>
  );
}
