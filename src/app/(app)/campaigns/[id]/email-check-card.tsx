"use client";

// The campaign's free email check: counts per status and reason, and "exclude" / "include again".
import { useState, useTransition } from "react";
import { Badge, Button } from "@/components/ui";
import { REASON_LABEL, type EmailReason, type EmailStatus } from "@/lib/email-check-labels";
import { excludeRiskyLeads, includeExcludedLeads } from "../actions";

const RISKY: EmailReason[] = ["typo", "a_only", "role", "personal", "dns_unknown"];
const INVALID: EmailReason[] = ["syntax", "disposable", "null_mx", "no_dns"];

export function EmailCheckCard({
  campaignId,
  byStatus,
  byReason,
  excluded,
  suggestions,
  canChange,
}: {
  campaignId: string;
  byStatus: Record<EmailStatus, number>;
  byReason: Partial<Record<EmailReason, number>>;
  excluded: number;
  suggestions: { email: string; suggestion: string }[];
  canChange: boolean;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error: string } | { count: number }>, done: (n: number) => string) =>
    start(async () => {
      const r = await fn();
      setMessage("error" in r ? r.error : done(r.count));
    });
  const risky = RISKY.filter((r) => byReason[r]);
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Email check</h2>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="green">{byStatus.valid} valid</Badge>
          <Badge tone="amber">{byStatus.risky} risky</Badge>
          <Badge tone="red">{byStatus.invalid} invalid</Badge>
          {byStatus.pending > 0 && <Badge tone="gray">{byStatus.pending} checking…</Badge>}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Free: format, throwaway domains, role and personal addresses, typos, and whether each domain has a mail server (DNS). No mailbox is ever contacted. Invalid
        addresses are left out automatically and use no credits.
      </p>
      {INVALID.some((r) => byReason[r]) && (
        <p className="text-xs text-rose-800">
          Left out: {INVALID.filter((r) => byReason[r]).map((r) => `${REASON_LABEL[r].toLowerCase()} (${byReason[r]})`).join(", ")}
        </p>
      )}
      {risky.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
          {risky.map((r) => (
            <li key={r} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-amber-900">
                {REASON_LABEL[r]} <span className="text-slate-500">({byReason[r]})</span>
              </span>
              {canChange && (
                <Button variant="ghost" disabled={pending} onClick={() => run(() => excludeRiskyLeads(campaignId, r), (n) => `${n} excluded.`)}>
                  Exclude
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canChange && (
        <div className="flex flex-wrap gap-2">
          {byStatus.risky > 0 && (
            <Button variant="secondary" disabled={pending} onClick={() => run(() => excludeRiskyLeads(campaignId, null), (n) => `${n} excluded.`)}>
              Exclude all risky
            </Button>
          )}
          {excluded > 0 && (
            <Button variant="ghost" disabled={pending} onClick={() => run(() => includeExcludedLeads(campaignId), (n) => `${n} included again.`)}>
              Include {excluded} excluded again
            </Button>
          )}
        </div>
      )}
      {suggestions.length > 0 && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer">Possible typos ({suggestions.length})</summary>
          <ul className="mt-2 space-y-1">
            {suggestions.map((s) => (
              <li key={s.email}>
                {s.email} → did you mean <strong>{s.suggestion}</strong>? <span className="text-slate-400">(not changed; fix it in your list and upload again)</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {message && <p className="text-xs text-slate-600">{message}</p>}
    </div>
  );
}
