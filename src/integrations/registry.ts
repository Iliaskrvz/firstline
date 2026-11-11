// Which adapter to use for a stored integration. Fake keys ("fake-…") only work outside production
// unless INTEGRATIONS_ALLOW_FAKE=1, so a click-through needs no real account.
import { FakeTool } from "./fake";
import { InstantlyTool } from "./instantly";
import { LemlistTool } from "./lemlist";
import { SmartleadTool } from "./smartlead";
import type { FetchLike, Provider, SendingTool } from "./types";

export function fakeKeysAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.INTEGRATIONS_ALLOW_FAKE === "1" || env.NODE_ENV !== "production";
}

export function isFakeKey(key: string): boolean {
  return /^fake[-_]/i.test(key.trim());
}

export function createTool(provider: Provider, apiKey: string, opts: { fetch?: FetchLike; env?: Record<string, string | undefined> } = {}): SendingTool {
  if (isFakeKey(apiKey)) {
    if (!fakeKeysAllowed(opts.env)) throw new Error("Fake keys are not allowed here.");
    return new FakeTool({ provider, webhooks: !/no-?hooks/i.test(apiKey), webhookMode: provider === "smartlead" ? "campaign" : "account" });
  }
  switch (provider) {
    case "instantly":
      return new InstantlyTool(apiKey.trim(), opts.fetch);
    case "smartlead":
      return new SmartleadTool(apiKey.trim(), opts.fetch);
    case "lemlist":
      return new LemlistTool(apiKey.trim(), opts.fetch);
  }
}
