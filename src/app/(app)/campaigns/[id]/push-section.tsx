// "Push to a sending tool" on the campaign page (§8 Lane B). Server part: loads integrations and pushes.
import Link from "next/link";
import { availableFields, defaultVariableMap } from "@/integrations/fields";
import { campaignPushes, listIntegrations, pushItems } from "@/integrations/push-pg";
import { PROVIDER_NAMES } from "@/integrations/types";
import { serverPool } from "@/server/db";
import { encryptionConfigured } from "@/server/integrations";
import { queueConfigured } from "@/server/queue";
import { AutoRefresh } from "./preview/auto-refresh";
import { PushPanel } from "./push-panel";

export async function PushSection({ campaignId, workspaceId, slotKeys, followUpSteps, written }: { campaignId: string; workspaceId: string; slotKeys: string[]; followUpSteps: number[]; written: number }) {
  if (!queueConfigured() || !encryptionConfigured()) return null;
  const pool = serverPool();
  const [integrations, pushes] = await Promise.all([listIntegrations(pool, workspaceId), campaignPushes(pool, workspaceId, campaignId, 5)]);
  const connected = integrations.filter((i) => i.status === "connected");
  const latest = pushes[0] ?? null;
  const items = latest ? await pushItems(pool, workspaceId, latest.id, 500) : [];
  const busy = pushes.some((p) => p.status === "queued" || p.status === "running");

  return (
    <div className="space-y-3">
      <AutoRefresh active={busy} intervalMs={3_000} />
      <div className="text-sm font-medium text-slate-700">Push to a sending tool</div>
      {!connected.length ? (
        <p className="text-sm text-slate-600">
          Use Instantly, Smartlead or Lemlist?{" "}
          <Link href="/integrations" className="font-medium text-indigo-700 hover:underline">
            Connect it
          </Link>{" "}
          and push these leads with their personalised lines as variables. Free.
        </p>
      ) : (
        <PushPanel
          campaignId={campaignId}
          integrations={connected.map((i) => ({ id: i.id, name: PROVIDER_NAMES[i.provider] }))}
          fields={availableFields(slotKeys, followUpSteps)}
          defaultMap={latest?.variable_map ?? defaultVariableMap(slotKeys, followUpSteps)}
          written={written}
          latest={
            latest && {
              id: latest.id,
              kind: latest.kind,
              status: latest.status,
              tool: PROVIDER_NAMES[latest.provider],
              toolCampaignName: latest.tool_campaign_name ?? latest.tool_campaign_id,
              total: latest.total,
              added: latest.added,
              skipped: latest.skipped,
              failed: latest.failed,
              error: latest.error,
            }
          }
          items={items}
          history={pushes.slice(1).map((p) => ({
            id: p.id,
            text: `${p.kind === "dry_run" ? "Dry run" : "Push"} to ${p.tool_campaign_name ?? p.tool_campaign_id}: ${p.added} added, ${p.skipped} skipped, ${p.failed} failed`,
          }))}
        />
      )}
    </div>
  );
}
