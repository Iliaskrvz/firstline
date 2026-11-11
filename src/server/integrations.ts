// Server-side helpers for sending-tool integrations (key, adapter factory, webhook URL).
import "server-only";
import { createTool } from "@/integrations/registry";
import type { PushDeps } from "@/integrations/push-pg";
import { encryptionConfigured, encryptionKey } from "@/lib/secret-box";
import { publicAppUrl } from "@/server/sender-view";

export { encryptionConfigured };

export function pushDeps(): PushDeps {
  return { key: encryptionKey(), toolFor: (provider, apiKey) => createTool(provider, apiKey), publicUrl: publicAppUrl() };
}

