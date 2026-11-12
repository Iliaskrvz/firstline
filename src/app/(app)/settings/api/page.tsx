import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui";
import { listApiKeys } from "@/api/core-pg";
import { MAX_BATCH, RATE_LIMIT_PER_MIN } from "@/api/schemas";
import { listEndpoints } from "@/api/webhooks-pg";
import { requireWorkspace } from "@/lib/auth";
import { isAdminRole } from "@/lib/team";
import { formatDate } from "@/lib/format";
import { encryptionConfigured } from "@/lib/secret-box";
import { serverPool } from "@/server/db";
import { queueConfigured } from "@/server/queue";
import { NewKey, NewWebhook, RemoveWebhook, RevokeKey } from "./api-forms";

export const metadata: Metadata = { title: "API" };

export default function ApiSettingsPage() {
  return (
    <>
      <PageHeader
        title="API"
        description={
          <>
            Use FirstLine from n8n, Make or your own code, with the same credits.{" "}
            <Link href="/docs/api" className="font-medium text-brand-700 hover:underline">
              Read the API docs →
            </Link>
          </>
        }
      />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Settings />
      </Suspense>
    </>
  );
}

async function Settings() {
  const { workspace, role } = await requireWorkspace();
  if (!queueConfigured() || !encryptionConfigured()) {
    return <Card className="text-sm text-slate-600">The API needs DATABASE_URL and INTEGRATIONS_ENCRYPTION_KEY in .env.local (see the README).</Card>;
  }
  const pool = serverPool();
  const [keys, hooks] = await Promise.all([
    listApiKeys(pool, workspace.id),
    listEndpoints(pool, workspace.id),
  ]);
  const isOwner = isAdminRole(role);
  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <h2 className="text-base font-semibold text-slate-900">API keys</h2>
        <p className="text-sm text-slate-600">
          A key gives full access to personalising with this workspace&apos;s credits. {RATE_LIMIT_PER_MIN} requests per minute per key, up to {MAX_BATCH} leads per batch.
        </p>
        {keys.length > 0 && (
          <ul className="divide-y divide-slate-100 text-sm">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <span className="font-medium text-slate-900">{k.name}</span> <code className="text-xs text-slate-500">{k.prefix}…</code>{" "}
                  {k.revoked_at && <Badge tone="red">Revoked</Badge>}
                  <div className="text-xs text-slate-500">
                    Created {formatDate(k.created_at.toISOString())} · {k.last_used_at ? `last used ${formatDate(k.last_used_at.toISOString())}` : "never used"}
                  </div>
                </div>
                {!k.revoked_at && isOwner && <RevokeKey id={k.id} name={k.name} />}
              </li>
            ))}
          </ul>
        )}
        {isOwner ? <NewKey /> : <p className="text-sm text-slate-500">Only the owner or an admin can create keys.</p>}
      </Card>

      <Card className="space-y-4">
        <h2 className="text-base font-semibold text-slate-900">Webhooks</h2>
        <p className="text-sm text-slate-600">
          FirstLine posts the finished job to these URLs (job.completed, batch.completed), signed with the endpoint&apos;s secret. See{" "}
          <Link href="/docs/api#webhooks" className="text-brand-700 hover:underline">
            how to check the signature
          </Link>
          .
        </p>
        {hooks.length > 0 && (
          <ul className="divide-y divide-slate-100 text-sm">
            {hooks.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <code className="text-xs text-slate-800">{h.url}</code>
                  <div className="text-xs text-slate-500">
                    {h.events.join(", ")} · {h.delivered} delivered{h.failed ? ` · ${h.failed} failed` : ""}
                    {h.last_error ? ` · last problem: ${h.last_error}` : ""}
                  </div>
                </div>
                {isOwner && <RemoveWebhook id={h.id} />}
              </li>
            ))}
          </ul>
        )}
        {isOwner && <NewWebhook />}
      </Card>
    </div>
  );
}
