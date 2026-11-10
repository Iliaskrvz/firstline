// The Kelviq client for the web app (server only). KELVIQ_ENV: "sandbox" (default) or "production";
// the API key must come from the same mode in the Kelviq dashboard.
import "server-only";
import { environmentFromEnv, Kelviq } from "@kelviq/node-sdk";

let client: Kelviq | null = null;

export function kelviqConfigured(): boolean {
  return !!process.env.KELVIQ_API_KEY?.trim();
}

export function kelviqClient(): Kelviq {
  client ??= new Kelviq({ accessToken: process.env.KELVIQ_API_KEY!.trim(), environment: environmentFromEnv(process.env.KELVIQ_ENV?.trim()) });
  return client;
}
