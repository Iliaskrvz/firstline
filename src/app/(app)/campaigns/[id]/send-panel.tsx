"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { setCampaignSending, startCampaignSending } from "../actions";

type Inbox = { id: string; email: string };

export function SendPanel({
  campaignId,
  inboxes,
  sendState,
  sendingInboxIds,
  ready,
  skippedFallbacks,
  defaultOptOut,
  counts,
}: {
  campaignId: string;
  inboxes: Inbox[];
  sendState: "sending" | "paused" | null;
  /** The inboxes this campaign sends from (once started). */
  sendingInboxIds: string[];
  ready: number;
  skippedFallbacks: number;
  defaultOptOut: string;
  counts: Record<string, number>;
}) {
  const [picked, setPicked] = useState<string[]>(inboxes.slice(0, 1).map((i) => i.id));
  const sendingFrom = inboxes.filter((i) => sendingInboxIds.includes(i.id)).map((i) => i.email);
  const [optOut, setOptOut] = useState(defaultOptOut);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ error?: string; info?: string } | null>(null);

  if (sendState) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-slate-700">Sending from {sendingFrom.join(", ") || "–"}</div>
          <span className={sendState === "sending" ? "text-xs font-medium text-emerald-700" : "text-xs font-medium text-amber-700"}>
            {sendState === "sending" ? "On" : "Paused"}
          </span>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center text-xs">
          {(["queued", "sent", "replied", "bounced", "paused", "stopped"] as const).map((k) => (
            <div key={k} className="rounded-lg bg-slate-50 py-2">
              <dd className="text-base font-semibold text-slate-900">{counts[k] ?? 0}</dd>
              <dt className="text-slate-500">{k === "paused" ? "paused (colleague replied)" : k}</dt>
            </div>
          ))}
        </dl>
        <Button
          variant="secondary"
          className="w-full"
          disabled={pending}
          onClick={() => start(async () => void (await setCampaignSending(campaignId, sendState === "sending" ? "paused" : "sending")))}
        >
          {sendState === "sending" ? "Pause this campaign" : "Resume this campaign"}
        </Button>
        {ready > 0 && (
          <Button
            variant="ghost"
            className="w-full"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await startCampaignSending({ campaignId, inboxIds: sendingInboxIds, optOutLine: optOut });
                setMessage("error" in res ? { error: res.error } : { info: `${res.queued} more queued.` });
              })
            }
          >
            Queue {ready} newly written {ready === 1 ? "email" : "emails"}
          </Button>
        )}
        {message && <p className={message.error ? "text-xs text-rose-700" : "text-xs text-slate-600"}>{message.error ?? message.info}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-slate-700">Send via Gmail</div>
      {inboxes.length === 0 ? (
        <p className="text-sm text-slate-600">
          <Link href="/inboxes" className="font-medium text-brand-700 hover:underline">
            Connect a Gmail inbox
          </Link>{" "}
          first.
        </p>
      ) : (
        <>
          <Field label="From" hint={picked.length > 1 ? "Leads are spread over these inboxes; each lead's follow-ups come from the same inbox." : undefined}>
            <div className="space-y-1.5">
              {inboxes.map((i) => (
                <label key={i.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-brand-600"
                    checked={picked.includes(i.id)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, i.id] : picked.filter((x) => x !== i.id))}
                  />
                  {i.email}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Opt-out line" hint="Added under every email. Leave empty to leave it out.">
            <input className={inputClass} value={optOut} onChange={(e) => setOptOut(e.target.value)} maxLength={200} />
          </Field>
          <Button
            className="w-full"
            disabled={pending || ready === 0 || picked.length === 0}
            onClick={() =>
              start(async () => {
                const res = await startCampaignSending({ campaignId, inboxIds: picked, optOutLine: optOut });
                if ("error" in res) setMessage({ error: res.error });
              })
            }
          >
            {pending ? "Queuing…" : ready === 0 ? "No written emails yet" : `Start sending ${ready} ${ready === 1 ? "email" : "emails"}`}
          </Button>
          <p className="text-center text-xs text-slate-500">
            Inside your sending window, 6–14 min apart.{skippedFallbacks > 0 && ` ${skippedFallbacks} fallback ${skippedFallbacks === 1 ? "lead is" : "leads are"} skipped, as chosen.`}
          </p>
          {message?.error && <p className="text-center text-xs text-rose-700">{message.error}</p>}
        </>
      )}
    </div>
  );
}
