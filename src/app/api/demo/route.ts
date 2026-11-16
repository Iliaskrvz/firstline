// POST /api/demo: the homepage demo. A visitor's website in, one example opener with sources out.
// Protection, in this order: demo switched on → valid public domain → Turnstile → DNS points only at
// public addresses (SSRF) → 3 per IP per day and a global daily cap → 30-day result cache → a run with
// a 20-second limit. Every paid call goes to usage_costs, tagged with the demo run.
import { NextResponse, type NextRequest } from "next/server";
import { engineConfig } from "@/engine/config";
import { cleanSells, runDemo, type DemoResult } from "@/engine/demo";
import { admitDemo, cachedDemo, finishDemo, hashIp } from "@/engine/demo-pg";
import { createFirecrawl } from "@/engine/firecrawl";
import { selectLLM } from "@/engine/llm";
import { FakeLLM } from "@/engine/llm-fake";
import { PgStore } from "@/engine/store-pg";
import { isPublicHost, parsePublicDomain } from "@/lib/public-host";
import { verifyTurnstile } from "@/lib/turnstile";
import { serverPool } from "@/server/db";
import { cannedReader, demoMode } from "@/server/demo";
import type { CostEntry } from "@/engine/types";

export const maxDuration = 30;

const err = (status: number, error: string, code: string) => NextResponse.json({ error, code }, { status });

export async function POST(request: NextRequest) {
  const mode = demoMode();
  if (mode === "off") return err(503, "The live demo isn't available right now.", "off");

  let body: { url?: unknown; sells?: unknown; token?: unknown };
  try {
    body = await request.json();
  } catch {
    return err(400, "Send a website address.", "bad_request");
  }
  const domain = typeof body.url === "string" ? parsePublicDomain(body.url) : null;
  if (!domain) return err(400, "Enter a company website, like acme.com.", "bad_url");
  const sells = cleanSells(typeof body.sells === "string" ? body.sells : "");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";

  if (mode === "live") {
    const ok = await verifyTurnstile(typeof body.token === "string" ? body.token : "", ip === "unknown" ? null : ip, process.env.TURNSTILE_SECRET_KEY!.trim());
    if (!ok) return err(403, "Please confirm you're not a robot, then try again.", "captcha");
    if (!(await isPublicHost(domain))) return err(400, "We can't read that address. Try a public company website.", "not_public");
  }

  const pool = serverPool();
  const salt = process.env.DEMO_IP_SALT?.trim() || process.env.INTEGRATIONS_ENCRYPTION_KEY?.trim() || "firstline-demo";
  const admit = await admitDemo(pool, { ipHash: hashIp(ip, salt), domain, sells });
  if (!admit.ok) {
    return admit.reason === "ip_limit"
      ? err(429, "You've tried 3 websites today. Create a free account to personalise 25 of your own leads.", "ip_limit")
      : err(429, "The demo has reached today's limit. Create a free account to try it on your own leads.", "daily_cap");
  }

  const hit = await cachedDemo(pool, domain, sells);
  if (hit) {
    const result = { ...hit, cached: true } as DemoResult;
    await finishDemo(pool, admit.id, result, [], { cached: true });
    return NextResponse.json(result);
  }

  const config = engineConfig();
  const costs: CostEntry[] = [];
  const result = await runDemo(
    { domain, sells },
    {
      store: new PgStore(pool),
      reader: mode === "test" ? cannedReader() : createFirecrawl(config.firecrawlApiKey!),
      llm: mode === "test" ? new FakeLLM() : await selectLLM(config),
      config,
    },
    costs,
  );
  await finishDemo(pool, admit.id, result, costs);
  return NextResponse.json(result);
}
