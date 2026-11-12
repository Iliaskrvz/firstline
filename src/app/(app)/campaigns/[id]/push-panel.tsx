"use client";

import { useState, useTransition } from "react";
import { Badge, Button, Field, inputClass } from "@/components/ui";
import type { VariableMapping } from "@/integrations/fields";
import type { PushItemView } from "@/integrations/push-pg";
import type { ToolCampaign } from "@/integrations/types";
import { listToolCampaigns, retryFailedPush, startPush } from "../push-actions";

type Latest = {
  id: string;
  kind: "dry_run" | "full";
  status: "queued" | "running" | "done" | "failed";
  tool: string;
  toolCampaignName: string;
  total: number;
  added: number;
  skipped: number;
  failed: number;
  error: string | null;
};

export function PushPanel({
  campaignId,
  integrations,
  fields,
  defaultMap,
  written,
  latest,
  items,
  history,
}: {
  campaignId: string;
  integrations: { id: string; name: string }[];
  fields: { field: string; label: string }[];
  defaultMap: VariableMapping[];
  written: number;
  latest: Latest | null;
  items: PushItemView[];
  history: { id: string; text: string }[];
}) {
  const [integrationId, setIntegrationId] = useState(integrations[0].id);
  const [campaigns, setCampaigns] = useState<ToolCampaign[] | null>(null);
  const [toolCampaign, setToolCampaign] = useState("");
  const [map, setMap] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.field, defaultMap.find((m) => m.field === f.field)?.variable ?? ""])));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = latest?.status === "queued" || latest?.status === "running";

  const load = () =>
    start(async () => {
      setError(null);
      const r = await listToolCampaigns(integrationId);
      if ("error" in r) setError(r.error);
      else {
        setCampaigns(r.campaigns);
        if (!r.campaigns.length) setError("No campaigns in this tool yet: create one there first.");
      }
    });

  const push = (kind: "dry_run" | "full") =>
    start(async () => {
      setError(null);
      const c = campaigns?.find((x) => x.id === toolCampaign);
      const r = await startPush({
        campaignId,
        integrationId,
        toolCampaignId: toolCampaign,
        toolCampaignName: c?.name ?? null,
        kind,
        variableMap: fields.map((f) => ({ field: f.field, variable: map[f.field] ?? "" })),
      });
      if ("error" in r) setError(r.error);
    });

  return (
    <div className="space-y-3 text-sm">
      {integrations.length > 1 && (
        <Field label="Tool">
          <select className={inputClass} value={integrationId} onChange={(e) => (setIntegrationId(e.target.value), setCampaigns(null), setToolCampaign(""))}>
            {integrations.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {campaigns ? (
        <Field label={`${integrations.find((i) => i.id === integrationId)?.name} campaign`}>
          <select className={inputClass} value={toolCampaign} onChange={(e) => setToolCampaign(e.target.value)}>
            <option value="">Pick a campaign…</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.status})
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Button variant="secondary" className="w-full" disabled={pending} onClick={load}>
          {pending ? "Loading…" : `Choose a ${integrations.find((i) => i.id === integrationId)?.name} campaign`}
        </Button>
      )}

      {campaigns && (
        <details className="rounded-lg border border-slate-200 p-3" open={!latest}>
          <summary className="cursor-pointer text-xs font-medium text-slate-700">Variables in the tool</summary>
          <p className="mt-2 text-xs text-slate-500">Use them in the tool&apos;s email as {"{{fl_full_email}}"} etc. Leave a name empty to skip that field.</p>
          <div className="mt-2 space-y-2">
            {fields.map((f) => (
              <label key={f.field} className="flex items-center gap-2 text-xs">
                <span className="w-36 shrink-0 text-slate-600">{f.label}</span>
                <input className={`${inputClass} py-1 font-mono text-xs`} value={map[f.field] ?? ""} onChange={(e) => setMap({ ...map, [f.field]: e.target.value })} />
              </label>
            ))}
          </div>
        </details>
      )}

      {campaigns && (
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" disabled={pending || busy || !toolCampaign} onClick={() => push("dry_run")}>
            Dry run (5 leads)
          </Button>
          <Button className="flex-1" disabled={pending || busy || !toolCampaign} onClick={() => push("full")}>
            Push all ({written})
          </Button>
        </div>
      )}
      {error && <p className="text-rose-700">{error}</p>}

      {latest && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-slate-900">
              {latest.kind === "dry_run" ? "Dry run" : "Push"} → {latest.tool}: {latest.toolCampaignName}
            </span>
            <Badge tone={latest.status === "done" ? (latest.failed ? "amber" : "green") : latest.status === "failed" ? "red" : "indigo"}>
              {latest.status === "queued" ? "Waiting" : latest.status === "running" ? "Pushing…" : latest.status === "done" ? "Done" : "Stopped"}
            </Badge>
          </div>
          {busy && (
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full bg-brand-600 transition-all" style={{ width: `${latest.total ? Math.round(((latest.added + latest.skipped + latest.failed) / latest.total) * 100) : 0}%` }} />
            </div>
          )}
          <p className="text-slate-700">
            {latest.added} added · {latest.skipped} skipped · {latest.failed} failed · {latest.total} total
          </p>
          {latest.error && <p className="text-xs text-rose-700">{latest.error}</p>}
          {latest.failed > 0 && !busy && (
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await retryFailedPush(latest.id, campaignId);
                  if ("error" in r) setError(r.error);
                })
              }
            >
              Retry failed ({latest.failed})
            </Button>
          )}
          {items.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-brand-700">Results per lead</summary>
              <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-xs">
                {items.map((i) => (
                  <li key={i.email} className="flex justify-between gap-2 border-b border-slate-100 pb-1">
                    <span className="truncate text-slate-800">{i.email}</span>
                    <span className={i.status === "failed" ? "text-rose-700" : i.status === "skipped" ? "text-amber-700" : "text-slate-600"}>
                      {i.status}
                      {i.reason ? `: ${i.reason}` : ""}
                      {i.replied ? " · replied" : ""}
                      {i.bounced ? " · bounced" : ""}
                      {i.unsubscribed ? " · unsubscribed" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {history.length > 0 && (
        <ul className="space-y-0.5 text-xs text-slate-500">
          {history.map((h) => (
            <li key={h.id}>{h.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
