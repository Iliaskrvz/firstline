// POST /api/demo: the homepage demo. A visitor's website in, one example opener with sources out.
// Protection, in this order: demo switched on → valid public domain → Turnstile → DNS points only at
// public addresses (SSRF) → 3 per IP per day and a global daily cap → 30-day result cache → a run with
// a 20-second limit. Every paid call goes to usage_costs, tagged with the demo run.
import { NextResponse, type NextRequest } from "next/server";
import { engineConfig } from "@/engine/config";
import { cleanSells, runDemo, type DemoLang, type DemoResult } from "@/engine/demo";
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

/** What the visitor reads when a try is refused, per language (/ is English, /nl Dutch). */
const MESSAGES = {
  en: {
    off: "The live demo isn't available right now.",
    bad_request: "Send a website address.",
    bad_url: "Enter a company website, like acme.com.",
    captcha: "Please confirm you're not a robot, then try again.",
    not_public: "We can't read that address. Try a public company website.",
    ip_limit: "You've tried 3 websites today. Create a free account to personalise 25 of your own leads.",
    daily_cap: "The demo has reached today's limit. Create a free account to try it on your own leads.",
  },
  nl: {
    off: "De live demo is nu niet beschikbaar.",
    bad_request: "Stuur een websiteadres mee.",
    bad_url: "Vul de website van een bedrijf in, zoals bedrijf.nl.",
    captcha: "Bevestig dat je geen robot bent en probeer het opnieuw.",
    not_public: "Dat adres kunnen we niet lezen. Probeer een openbare bedrijfswebsite.",
    ip_limit: "Je hebt vandaag 3 websites geprobeerd. Maak een gratis account aan om 25 van je eigen leads te personaliseren.",
    daily_cap: "De demo heeft de limiet van vandaag bereikt. Maak een gratis account aan om het op je eigen leads te proberen.",
  },
} as const;

export async function POST(request: NextRequest) {
  const mode = demoMode();
  if (mode === "off") return err(503, MESSAGES.en.off, "off");

  let body: { url?: unknown; sells?: unknown; token?: unknown; lang?: unknown };
  try {
    body = await request.json();
  } catch {
    return err(400, MESSAGES.en.bad_request, "bad_request");
  }
  const lang: DemoLang = body.lang === "nl" ? "nl" : "en";
  const m = MESSAGES[lang];
  const domain = typeof body.url === "string" ? parsePublicDomain(body.url) : null;
  if (!domain) return err(400, m.bad_url, "bad_url");
  const sells = cleanSells(typeof body.sells === "string" ? body.sells : "");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";

  if (mode === "live") {
    const ok = await verifyTurnstile(typeof body.token === "string" ? body.token : "", ip === "unknown" ? null : ip, process.env.TURNSTILE_SECRET_KEY!.trim());
    if (!ok) return err(403, m.captcha, "captcha");
    if (!(await isPublicHost(domain))) return err(400, m.not_public, "not_public");
  }

  const pool = serverPool();
  const salt = process.env.DEMO_IP_SALT?.trim() || process.env.INTEGRATIONS_ENCRYPTION_KEY?.trim() || "firstline-demo";
  const admit = await admitDemo(pool, { ipHash: hashIp(ip, salt), domain, sells, lang });
  if (!admit.ok) return err(429, m[admit.reason], admit.reason);

  const hit = await cachedDemo(pool, domain, sells, new Date(), lang);
  if (hit) {
    const result = { ...hit, cached: true } as DemoResult;
    await finishDemo(pool, admit.id, result, [], { cached: true });
    return NextResponse.json(result);
  }

  const config = engineConfig();
  const costs: CostEntry[] = [];
  const result = await runDemo(
    { domain, sells, lang },
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
