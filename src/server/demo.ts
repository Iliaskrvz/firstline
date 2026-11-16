// When the public demo is available, and what it runs on (server only).
//   live: a real AI provider + key, Firecrawl, and Turnstile keys; DEMO_ENABLED=0 switches it off.
//   test: local development only (DEMO_TEST_MODE=1): test output, a canned website, no captcha, $0.
//   off:  anything else; the homepage shows the static example instead.
import "server-only";
import { engineConfig } from "@/engine/config";
import type { WebReader } from "@/engine/firecrawl";

export type DemoMode = "live" | "test" | "off";

export function demoMode(env: Record<string, string | undefined> = process.env): DemoMode {
  if (env.NODE_ENV !== "production" && env.DEMO_TEST_MODE === "1") return "test";
  if (env.DEMO_ENABLED === "0") return "off";
  const c = engineConfig(env);
  const aiReady = (c.llmProvider === "deepseek" && !!c.deepseekApiKey) || (c.llmProvider === "anthropic" && !!c.anthropicApiKey);
  const ready = aiReady && !!c.firecrawlApiKey && !!env.TURNSTILE_SITE_KEY?.trim() && !!env.TURNSTILE_SECRET_KEY?.trim();
  return ready ? "live" : "off";
}

export const turnstileSiteKey = (env: Record<string, string | undefined> = process.env) => env.TURNSTILE_SITE_KEY?.trim() || null;

/** Test mode's website: the same two pages for every domain, so the demo can be tried without spending anything. */
export function cannedReader(): WebReader {
  const page = (domain: string, path: string) =>
    path === "/"
      ? `# ${domain}\n\nWe design packaging for independent food brands across the Netherlands. From the first sketch to the printed box, one team handles the whole process.`
      : `# News\n\nWe opened a second studio in Rotterdam this autumn to work closer to our clients in the port area. The team grew to twelve designers this year.`;
  return {
    robots: async () => null,
    map: async (url) => {
      const host = new URL(url).hostname;
      return { links: [{ url: `https://${host}/` }, { url: `https://${host}/news` }], credits: 0 };
    },
    scrape: async (url) => {
      const u = new URL(url);
      return { markdown: page(u.hostname, u.pathname), statusCode: 200, credits: 0 };
    },
  };
}
