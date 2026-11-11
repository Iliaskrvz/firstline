import type { Metadata } from "next";
import { Suspense } from "react";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui";
import { listIntegrations } from "@/integrations/push-pg";
import { LIVE_PROVIDERS, PROVIDER_NAMES, PROVIDERS } from "@/integrations/types";
import { requireWorkspace } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { serverPool } from "@/server/db";
import { encryptionConfigured } from "@/server/integrations";
import { queueConfigured } from "@/server/queue";
import { ConnectForm, IntegrationActions } from "./integration-forms";

export const metadata: Metadata = { title: "Integrations" };

const HELP: Record<string, string> = {
  instantly: "Instantly → Settings → Integrations → API Keys → Create API key. Pick API v2 and the all:all scope (or leads, campaigns and webhooks).",
  smartlead: "Smartlead → Settings → API Keys → copy your API key. FirstLine adds its webhook to each Smartlead campaign the first time you push to it.",
  lemlist: "Lemlist → Settings → Integrations → API → Generate. For webhooks, the Lemlist user needs the \"Edit integrations\" permission.",
};

export default function IntegrationsPage() {
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Push personalised leads into the sending tool you already use. Pushing is free: you paid for the personalisation. Keys are stored encrypted."
      />
      <Suspense fallback={<Skeleton className="h-48" />}>
        <List />
      </Suspense>
    </>
  );
}

async function List() {
  const { workspace } = await requireWorkspace();
  if (!queueConfigured() || !encryptionConfigured()) {
    return (
      <Card className="text-sm text-slate-600">
        Integrations need DATABASE_URL and INTEGRATIONS_ENCRYPTION_KEY in .env.local (see the README).
      </Card>
    );
  }
  const rows = await listIntegrations(serverPool(), workspace.id);
  const fakeHint = process.env.NODE_ENV !== "production" || process.env.INTEGRATIONS_ALLOW_FAKE === "1";
  return (
    <div className="space-y-6">
      {PROVIDERS.map((p) => {
        const i = rows.find((r) => r.provider === p);
        const live = LIVE_PROVIDERS.includes(p);
        return (
          <Card key={p} className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-slate-900">{PROVIDER_NAMES[p]}</h2>
                {!live ? (
                  <Badge>coming soon</Badge>
                ) : i ? (
                  <Badge tone={i.status === "connected" ? "green" : "red"}>{i.status === "connected" ? "Connected" : "Key problem"}</Badge>
                ) : (
                  <Badge>Not connected</Badge>
                )}
              </div>
              {i && <IntegrationActions integrationId={i.id} />}
            </div>
            {i ? (
              <div className="space-y-2 text-sm text-slate-700">
                <p>
                  {i.account_name ? `Workspace "${i.account_name}"` : "Connected"} · key …{i.key_hint} · checked {i.last_checked_at ? formatDate(i.last_checked_at.toISOString()) : "never"}
                </p>
                <p>
                  {i.capabilities.webhooks ? (
                    <>Replies, bounces and unsubscribes arrive instantly by webhook.</>
                  ) : (
                    <>{i.capabilities.reason ?? "No webhooks: FirstLine checks statuses every 15 minutes."}</>
                  )}
                </p>
                {i.last_error && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{i.last_error}</p>}
                <p className="text-xs text-slate-500">To push, open a campaign with written leads and use “Push to a sending tool”.</p>
              </div>
            ) : live ? (
              <>
                <p className="text-sm text-slate-600">{HELP[p]}</p>
                <ConnectForm provider={p} fakeHint={fakeHint} />
              </>
            ) : (
              <p className="text-sm text-slate-500">Coming next. Until then, export a CSV with fl_ columns from the campaign page.</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
