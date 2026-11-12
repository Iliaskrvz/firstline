// One-time Polar setup on the account the token belongs to (POLAR_SERVER: production by default).
//   npx tsx scripts/polar-setup.ts [https://your-public-address]
// 1. Checks POLAR_ACCESS_TOKEN works (never prints it).
// 2. If there's no active product: creates "Test Product", one-time $10.
// 3. If an address is given and no webhook endpoint points at <address>/api/webhook/polar yet:
//    creates one (format raw, order + customer state events) and saves its signing secret in
//    .env.local as POLAR_WEBHOOK_SECRET, without printing it.
// 4. Creates a single-use 100%-off code for the test product, to test checkout without paying.
// Safe to run again: it reuses what exists. No organization_id is sent (the token already has one).
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: true, quiet: true });

const token = process.env.POLAR_ACCESS_TOKEN?.trim();
const server = process.env.POLAR_SERVER?.trim() === "sandbox" ? "sandbox" : "production";
const API = server === "sandbox" ? "https://sandbox-api.polar.sh" : "https://api.polar.sh";
const publicUrl = process.argv[2]?.replace(/\/+$/, "");
const WEBHOOK_EVENTS = ["order.created", "order.paid", "order.updated", "order.refunded", "customer.state_changed"];

if (!token || token === "fake-polar") {
  console.error("POLAR_ACCESS_TOKEN isn't set in .env.local. Save it first: bash scripts/set-env.sh POLAR_ACCESS_TOKEN");
  process.exit(1);
}

async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${API}${path}`, {
    method,
    redirect: "follow",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data: data as T };
}

function fail(step: string, status: number, data: unknown): never {
  // Error bodies from Polar describe the problem; they never contain the token.
  console.error(`${step} failed (HTTP ${status}): ${JSON.stringify(data).slice(0, 400)}`);
  if (status === 401 || status === 403) {
    console.error(`Check the token: created in ${server} (sandbox and production are separate) with read+write for products, checkouts, webhooks and discounts.`);
  }
  process.exit(1);
}

function saveEnv(name: string, value: string) {
  const file = ".env.local";
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => !l.startsWith(`${name}=`));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  writeFileSync(file, `${lines.join("\n")}\n${name}=${value}\n`);
  chmodSync(file, 0o600);
}

type Product = { id: string; name: string; is_archived: boolean };
type Page<T> = { items: T[]; pagination: { total_count: number } };
type Endpoint = { id: string; url: string; secret?: string };

async function main() {
  console.log(`Polar ${server} (${API})`);

  // 1. Token check
  const check = await api<Page<Product>>("GET", "/v1/products/?limit=1");
  if (check.status < 200 || check.status >= 300) fail("Token check", check.status, check.data);
  console.log("✓ Token works");

  // 2. Product
  const list = await api<Page<Product>>("GET", "/v1/products/?limit=100&is_archived=false");
  if (list.status >= 300) fail("Listing products", list.status, list.data);
  let product = list.data.items.find((p) => !p.is_archived && p.name === "Test Product") ?? list.data.items.find((p) => !p.is_archived);
  if (product) {
    console.log(`✓ Product exists: ${product.name} (${product.id})`);
  } else {
    const created = await api<Product>("POST", "/v1/products/", {
      name: "Test Product",
      visibility: "public",
      prices: [{ amount_type: "fixed", price_amount: 1000, price_currency: "usd" }],
    });
    if (created.status >= 300) fail("Creating the test product", created.status, created.data);
    product = created.data;
    console.log(`✓ Created Test Product, one-time $10 (${product.id})`);
  }

  // 3. Webhook endpoint
  if (publicUrl) {
    const target = `${publicUrl}/api/webhook/polar`;
    const eps = await api<Page<Endpoint>>("GET", "/v1/webhooks/endpoints?limit=100");
    if (eps.status >= 300) fail("Listing webhook endpoints", eps.status, eps.data);
    const existing = eps.data.items.find((e) => e.url === target);
    if (existing) {
      console.log(`✓ Webhook endpoint exists (${existing.id}) → ${target}`);
      if (!process.env.POLAR_WEBHOOK_SECRET?.trim() && existing.secret) {
        saveEnv("POLAR_WEBHOOK_SECRET", existing.secret);
        console.log("✓ POLAR_WEBHOOK_SECRET saved in .env.local (not shown)");
      }
    } else {
      const ep = await api<Endpoint>("POST", "/v1/webhooks/endpoints", { url: target, format: "raw", api_version: "2026-10", name: "FirstLine", events: WEBHOOK_EVENTS });
      if (ep.status >= 300 || !ep.data.secret) fail("Creating the webhook endpoint", ep.status, { ...ep.data, secret: undefined });
      saveEnv("POLAR_WEBHOOK_SECRET", ep.data.secret!);
      console.log(`✓ Created webhook endpoint (${ep.data.id}) → ${target}`);
      console.log("✓ POLAR_WEBHOOK_SECRET saved in .env.local (not shown)");
    }
  } else {
    console.log("• No public address given: webhook endpoint skipped. Run again with the address to add it.");
  }

  // 4. 100% test discount (single use, test product only)
  const code = `FLTEST${randomBytes(4).toString("hex").toUpperCase()}`;
  const disc = await api<{ id: string }>("POST", "/v1/discounts/", {
    name: "Test checkout (100% off, single use)",
    type: "percentage",
    basis_points: 10000,
    duration: "once",
    code,
    max_redemptions: 1,
    products: [product.id],
  });
  if (disc.status >= 300) {
    console.log(`• Test discount not created (HTTP ${disc.status}). Add the discounts scope to the token, or make a 100% code in the dashboard.`);
  } else {
    console.log(`✓ Test discount code ${code} (single use, 100% off the test product, id ${disc.data.id})`);
  }

  console.log("");
  console.log(`Checkout link (local):  http://localhost:3000/checkout?products=${product.id}`);
  if (publicUrl) console.log(`Checkout link (live):   ${publicUrl}/checkout?products=${product.id}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
