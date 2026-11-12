// The Polar client for the web app (server only), one per process. POLAR_SERVER picks production
// (default) or sandbox; POLAR_ACCESS_TOKEN must come from that same environment.
import "server-only";
import { createPolar } from "@polar-sh/sdk/2026-10";
import { fakePolarCheckouts, polarEnvironment, type PolarCheckouts } from "@/billing/polar";

let client: ReturnType<typeof createPolar> | null = null;

/** Fake mode: POLAR_ACCESS_TOKEN=fake-polar, or no token outside production. */
export function polarFake(): boolean {
  const token = process.env.POLAR_ACCESS_TOKEN?.trim();
  return token === "fake-polar" || (!token && process.env.NODE_ENV !== "production");
}

export function polarConfigured(): boolean {
  return polarFake() || !!process.env.POLAR_ACCESS_TOKEN?.trim();
}

export function polarClient(): ReturnType<typeof createPolar> {
  client ??= createPolar({ accessToken: process.env.POLAR_ACCESS_TOKEN!.trim(), environment: polarEnvironment() });
  return client;
}

export function polarCheckouts(origin: string): PolarCheckouts {
  return polarFake() ? fakePolarCheckouts(origin) : polarClient().checkouts;
}
