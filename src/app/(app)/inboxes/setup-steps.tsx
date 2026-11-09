"use client";

import { CopyButton } from "@/components/copy-button";

/** The 4 setup steps (§10.6), shown right after a key is created. The key is shown only here, once. */
export function SetupSteps({ email, senderKey, appUrl, script }: { email: string; senderKey: string; appUrl: string | null; script: string }) {
  return (
    <div className="space-y-4 rounded-xl bg-indigo-50/60 p-4 ring-1 ring-indigo-100">
      <div>
        <div className="text-sm font-semibold text-slate-900">Connect {email}</div>
        <p className="mt-0.5 text-xs text-slate-600">
          Copy the key now: for your safety it is shown only once. Lost it? Create a new key; the old one stops working.
        </p>
      </div>

      <ol className="space-y-4 text-sm text-slate-800">
        <li>
          <b>1.</b> In Google Sheets, signed in as <b>{email}</b>: create a blank spreadsheet, then <b>Extensions → Apps Script</b>.
        </li>
        <li className="space-y-1.5">
          <div>
            <b>2.</b> Replace everything in <code>Code.gs</code> with this script, click <b>Save</b>, close the tab and reload the sheet.
          </div>
          <CopyButton text={script} label="Copy the script" className="px-3 py-1.5 text-xs" />
        </li>
        <li className="space-y-1.5">
          <div>
            <b>3.</b> In the sheet: <b>FirstLine → Connect…</b> and paste these two:
          </div>
          <Row label="FirstLine address" value={appUrl} missing="Not set: start the tunnel and set PUBLIC_APP_URL (Google can't reach localhost)." />
          <Row label="Sender key" value={senderKey} />
        </li>
        <li>
          <b>4.</b> Allow the permissions Google asks for (<b>Advanced → Go to … (unsafe) → Allow</b>; it&apos;s your own script). The
          inbox shows <b>Connected</b> here within a minute.
        </li>
      </ol>
    </div>
  );
}

function Row({ label, value, missing }: { label: string; value: string | null; missing?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-32 shrink-0 text-xs text-slate-500">{label}</div>
      {value ? (
        <>
          <code className="min-w-0 flex-1 truncate rounded-md bg-white px-2 py-1.5 text-xs ring-1 ring-slate-200">{value}</code>
          <CopyButton text={value} />
        </>
      ) : (
        <div className="text-xs text-rose-700">{missing}</div>
      )}
    </div>
  );
}
