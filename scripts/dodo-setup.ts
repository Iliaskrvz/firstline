// One-time Dodo Payments setup on the business the key belongs to. Test or live follows the key:
// dodo_test_… → test mode (test.dodopayments.com), dodo_live_… → live mode. Run it once per mode.
//   npx tsx scripts/dodo-setup.ts [https://your-public-address]
// 1. Checks DODO_API_KEY works (never prints it).
// 2. One one-time product per pack on sale (src/config/packs.ts, PACKS_ENABLED), priced from the
//    config in EUR, excluding VAT (Dodo adds it at checkout as merchant of record). Saves each id in
//    .env.local as DODO_PRODUCT_<PACK> (ids aren't secret). Existing ones are found by their metadata.
// 3. If an address is given and no webhook endpoint points at <address>/api/webhook/dodo yet:
//    creates one (payment.succeeded, refund.succeeded) and saves its signing secret in .env.local as
//    DODO_WEBHOOK_SECRET, without printing it.
// Safe to run again: it reuses what exists.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import DodoPayments from "dodopayments";
import { config as loadEnv } from "dotenv";
import { dodoEnvironment, dodoProductEnvName } from "../src/billing/dodo";
import { enabledPacks } from "../src/lib/credits";

loadEnv({ path: ".env.local", override: true, quiet: true });

const key = process.env.DODO_API_KEY?.trim();
const publicUrl = process.argv.slice(2).find((a) => a.startsWith("http"))?.replace(/\/+$/, "");
const WEBHOOK_EVENTS = ["payment.succeeded", "refund.succeeded"] as const;

if (!key || key === "fake-dodo") {
  console.error("DODO_API_KEY isn't set in .env.local. Save it first: bash scripts/set-env.sh DODO_API_KEY");
  process.exit(1);
}
const mode = dodoEnvironment(key);
const dodo = new DodoPayments({ bearerToken: key, environment: mode });

function saveEnv(name: string, value: string) {
  const file = ".env.local";
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => !l.startsWith(`${name}=`));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  writeFileSync(file, `${lines.join("\n")}\n${name}=${value}\n`);
  chmodSync(file, 0o600);
}

function fail(step: string, e: unknown): never {
  // API errors describe the problem; they never contain the key.
  const err = e as { status?: number; message?: string };
  console.error(`${step} failed${err.status ? ` (HTTP ${err.status})` : ""}: ${String(err.message ?? e).slice(0, 400)}`);
  if (err.status === 401) console.error(`Check the key: ${mode === "test_mode" ? "a test key (dodo_test_…)" : "a live key (dodo_live_…)"} from Dodo → Developer → API Keys.`);
  process.exit(1);
}

async function main() {
  console.log(`Dodo Payments, ${mode === "live_mode" ? "LIVE mode (real payments)" : "test mode"}`);

  // 1. Key check + existing products (by our metadata)
  const existing = new Map<string, string>();
  try {
    for await (const p of dodo.products.list({ page_size: 100 })) {
      const pack = p.metadata?.firstline_pack;
      if (typeof pack === "string" && !existing.has(pack)) existing.set(pack, p.product_id);
    }
  } catch (e) {
    fail("Key check", e);
  }
  console.log("✓ Key works");

  // 2. Products, one per pack on sale
  for (const pack of enabledPacks()) {
    let id = existing.get(pack.id);
    if (id) {
      console.log(`✓ ${pack.name}: product exists (${id})`);
    } else {
      try {
        const created = await dodo.products.create({
          name: `FirstLine ${pack.name}: ${pack.credits.toLocaleString("en")} credits`,
          description: `${pack.credits.toLocaleString("en")} FirstLine credits. 1 credit = 1 personalised email. Credits never expire.`,
          tax_category: "saas",
          price: { type: "one_time_price", currency: "EUR", price: pack.priceCents, discount: 0, purchasing_power_parity: false, tax_inclusive: false },
          metadata: { firstline_pack: pack.id },
        });
        id = created.product_id;
        console.log(`✓ ${pack.name}: product created (${id}), €${(pack.priceCents / 100).toFixed(2)} excl. VAT`);
      } catch (e) {
        fail(`Creating the ${pack.name} product`, e);
      }
    }
    saveEnv(dodoProductEnvName(pack.id), id);
  }

  // 3. Webhook endpoint
  if (!publicUrl) {
    console.log("No address given: skipped the webhook. Run again with your https address to create it.");
    return;
  }
  const url = `${publicUrl}/api/webhook/dodo`;
  let webhookId: string | null = null;
  try {
    for await (const w of dodo.webhooks.list()) {
      if (w.url === url) webhookId = w.id;
    }
    if (webhookId) {
      console.log(`✓ Webhook exists for ${url}`);
    } else {
      const w = await dodo.webhooks.create({ url, description: "FirstLine credits", filter_types: [...WEBHOOK_EVENTS] });
      webhookId = w.id;
      console.log(`✓ Webhook created for ${url} (${WEBHOOK_EVENTS.join(", ")})`);
    }
    const { secret } = await dodo.webhooks.retrieveSecret(webhookId);
    saveEnv("DODO_WEBHOOK_SECRET", secret);
    console.log("✓ Signing secret saved in .env.local as DODO_WEBHOOK_SECRET (not shown)");
  } catch (e) {
    fail("Webhook setup", e);
  }
  console.log("\nDone. Deploy so the server gets the new settings.");
}

main();
