// Runs every migration inside PGlite (in-process Postgres) and checks the
// parts that must never break: workspace on signup, RLS isolation and the
// credit ledger (reserve / capture / release / purchase).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const USER_A = "00000000-0000-0000-0000-00000000000a";
const USER_B = "00000000-0000-0000-0000-00000000000b";

let db: PGlite;
let wsA: string;
let wsB: string;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

async function balance(ws: string) {
  const r = await db.query<{ available: number; reserved: number; spent: number }>(
    "select available, reserved, spent from public.workspace_balance where workspace_id = $1",
    [ws],
  );
  return r.rows[0];
}

async function addLead(ws: string, campaign: string, email: string) {
  const r = await db.query<{ id: string }>(
    "insert into public.leads (campaign_id, workspace_id, email) values ($1, $2, $3) returning id",
    [campaign, ws, email],
  );
  return r.rows[0].id;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  const dir = path.join(root, "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(dir, f), "utf8"));
  }
  await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
    USER_A,
    "anna@acme.nl",
    { full_name: "Anna" },
  ]);
  await db.query("insert into auth.users (id, email) values ($1, $2)", [USER_B, "bob@other.com"]);
  const ws = await db.query<{ id: string; owner_id: string }>("select id, owner_id from public.workspaces");
  wsA = ws.rows.find((r) => r.owner_id === USER_A)!.id;
  wsB = ws.rows.find((r) => r.owner_id === USER_B)!.id;
});

describe("signup", () => {
  it("creates a workspace with the user as owner", async () => {
    const r = await db.query<{ name: string; role: string }>(
      `select w.name, m.role from public.workspaces w
       join public.workspace_members m on m.workspace_id = w.id where m.user_id = $1`,
      [USER_A],
    );
    expect(r.rows).toEqual([{ name: "Anna's workspace", role: "owner" }]);
  });
});

describe("row level security", () => {
  it("users only see their own workspace", async () => {
    const rows = await asUser(USER_A, async () => (await db.query("select id from public.workspaces")).rows);
    expect(rows).toEqual([{ id: wsA }]);
  });

  it("users cannot create a campaign in someone else's workspace", async () => {
    await expect(
      asUser(USER_A, () =>
        db.query("insert into public.campaigns (workspace_id, name) values ($1, 'x')", [wsB]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("users can create and read their own campaigns and leads", async () => {
    const leads = await asUser(USER_A, async () => {
      const c = await db.query<{ id: string }>(
        "insert into public.campaigns (workspace_id, name) values ($1, 'Mine') returning id",
        [wsA],
      );
      await db.query("insert into public.leads (campaign_id, workspace_id, email) values ($1, $2, 'a@b.nl')", [
        c.rows[0].id,
        wsA,
      ]);
      return (await db.query("select email from public.leads")).rows;
    });
    expect(leads).toEqual([{ email: "a@b.nl" }]);
    const other = await asUser(USER_B, async () => (await db.query("select * from public.leads")).rows);
    expect(other).toEqual([]);
  });

  it("a lead cannot point at another workspace's campaign", async () => {
    const c = await db.query<{ id: string }>(
      "insert into public.campaigns (workspace_id, name) values ($1, 'B camp') returning id",
      [wsB],
    );
    await expect(addLead(wsA, c.rows[0].id, "x@y.nl")).rejects.toThrow(/foreign key/);
  });

  it("users cannot write to the ledger or grant themselves credits", async () => {
    await expect(
      asUser(USER_A, () =>
        db.query("insert into public.credit_ledger (workspace_id, type, amount) values ($1, 'bonus', 1000)", [wsA]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(USER_A, () => db.query("select public.add_purchase($1, 1000, 'evt_fake')", [wsA])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(USER_A, () => db.query("select public.reserve_credits(gen_random_uuid(), 1)")),
    ).rejects.toThrow(/permission denied/);
  });

  it("global tables are invisible to users", async () => {
    await db.query("insert into public.domain_research (domain) values ('acme.nl')");
    const rows = await asUser(USER_A, async () => (await db.query("select * from public.domain_research")).rows);
    expect(rows).toEqual([]);
  });

  it("inbox sender keys are not readable by users", async () => {
    await expect(
      asUser(USER_A, () => db.query("select sender_key_hash from public.inboxes")),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("credit ledger", () => {
  let campaign: string;

  beforeAll(async () => {
    const c = await db.query<{ id: string }>(
      "insert into public.campaigns (workspace_id, name) values ($1, 'Ledger') returning id",
      [wsA],
    );
    campaign = c.rows[0].id;
  });

  it("purchases are idempotent on stripe_event_id", async () => {
    const first = await db.query<{ ok: boolean }>("select public.add_purchase($1, 10, 'evt_1') as ok", [wsA]);
    const again = await db.query<{ ok: boolean }>("select public.add_purchase($1, 10, 'evt_1') as ok", [wsA]);
    expect(first.rows[0].ok).toBe(true);
    expect(again.rows[0].ok).toBe(false);
    expect(await balance(wsA)).toEqual({ available: 10, reserved: 0, spent: 0 });
  });

  it("reserve -> capture moves credits to spent, exactly once", async () => {
    const lead = await addLead(wsA, campaign, "cap@x.nl");
    await db.query("select public.reserve_credits($1, 2)", [lead]);
    await db.query("select public.reserve_credits($1, 2)", [lead]); // retry: no double reserve
    expect(await balance(wsA)).toEqual({ available: 8, reserved: 2, spent: 0 });

    const c1 = await db.query<{ n: number }>("select public.capture_credits($1, 2) as n", [lead]);
    const c2 = await db.query<{ n: number }>("select public.capture_credits($1, 2) as n", [lead]); // crashed worker retry
    expect([c1.rows[0].n, c2.rows[0].n]).toEqual([2, 0]);
    expect(await balance(wsA)).toEqual({ available: 8, reserved: 0, spent: 2 });
  });

  it("partial capture + release (e.g. base succeeded, Deep add-on failed)", async () => {
    const lead = await addLead(wsA, campaign, "partial@x.nl");
    await db.query("select public.reserve_credits($1, 2)", [lead]);
    await db.query("select public.capture_credits($1, 1)", [lead]);
    const rel = await db.query<{ n: number }>("select public.release_credits($1) as n", [lead]);
    expect(rel.rows[0].n).toBe(1);
    expect(await balance(wsA)).toEqual({ available: 7, reserved: 0, spent: 3 });
  });

  it("fallback releases everything and costs nothing", async () => {
    const lead = await addLead(wsA, campaign, "fallback@x.nl");
    await db.query("select public.reserve_credits($1, 1)", [lead]);
    await db.query("select public.release_credits($1)", [lead]);
    await db.query("select public.release_credits($1)", [lead]); // idempotent
    expect(await balance(wsA)).toEqual({ available: 7, reserved: 0, spent: 3 });
  });

  it("refuses to reserve more than is available", async () => {
    const lead = await addLead(wsA, campaign, "big@x.nl");
    const r = await db.query<{ ok: boolean }>("select public.reserve_credits($1, 100) as ok", [lead]);
    expect(r.rows[0].ok).toBe(false);
    expect(await balance(wsA)).toEqual({ available: 7, reserved: 0, spent: 3 });
  });

  it("cancelling a campaign releases all open reservations", async () => {
    const l1 = await addLead(wsA, campaign, "c1@x.nl");
    const l2 = await addLead(wsA, campaign, "c2@x.nl");
    await db.query("select public.reserve_credits($1, 1)", [l1]);
    await db.query("select public.reserve_credits($1, 3)", [l2]);
    expect(await balance(wsA)).toEqual({ available: 3, reserved: 4, spent: 3 });
    const r = await db.query<{ n: number }>("select public.release_campaign_credits($1) as n", [campaign]);
    expect(r.rows[0].n).toBe(4);
    expect(await balance(wsA)).toEqual({ available: 7, reserved: 0, spent: 3 });
  });

  it("ledger rows can never be updated", async () => {
    await expect(db.query("update public.credit_ledger set amount = 999")).rejects.toThrow(/append-only/);
  });

  it("deleting a lead keeps its ledger history", async () => {
    const lead = await addLead(wsA, campaign, "gone@x.nl");
    await db.query("select public.reserve_credits($1, 1)", [lead]);
    await db.query("select public.capture_credits($1, 1)", [lead]);
    await db.query("delete from public.leads where id = $1", [lead]);
    expect(await balance(wsA)).toEqual({ available: 6, reserved: 0, spent: 4 });
  });

  it("users see their own balance via the view", async () => {
    const rows = await asUser(USER_A, async () =>
      (await db.query("select workspace_id, available from public.workspace_balance")).rows,
    );
    expect(rows).toEqual([{ workspace_id: wsA, available: 6 }]);
  });
});

describe("ledger rules (hardening)", () => {
  let campaign: string;

  beforeAll(async () => {
    const c = await db.query<{ id: string }>(
      "insert into public.campaigns (workspace_id, name) values ($1, 'Rules') returning id",
      [wsB],
    );
    campaign = c.rows[0].id;
    await db.query("select public.add_purchase($1, 20, 'evt_rules')", [wsB]);
  });

  const ledgerFor = async (lead: string) =>
    (
      await db.query<{ type: string; amount: number }>(
        "select type, amount from public.credit_ledger where lead_id = $1 order by id",
        [lead],
      )
    ).rows;

  it("double capture only charges once", async () => {
    const lead = await addLead(wsB, campaign, "dbl@x.nl");
    await db.query("select public.reserve_credits($1, 1)", [lead]);
    const a = await db.query<{ n: number }>("select public.capture_credits($1, 1) as n", [lead]);
    const b = await db.query<{ n: number }>("select public.capture_credits($1, 1) as n", [lead]);
    expect([a.rows[0].n, b.rows[0].n]).toEqual([1, 0]);
    expect(await ledgerFor(lead)).toEqual([
      { type: "reserve", amount: -1 },
      { type: "capture", amount: 1 },
    ]);
  });

  it("release after a full capture releases nothing", async () => {
    const lead = await addLead(wsB, campaign, "relafter@x.nl");
    await db.query("select public.reserve_credits($1, 2)", [lead]);
    await db.query("select public.capture_credits($1, 2)", [lead]);
    const r = await db.query<{ n: number }>("select public.release_credits($1) as n", [lead]);
    expect(r.rows[0].n).toBe(0);
    expect((await ledgerFor(lead)).map((x) => x.type)).toEqual(["reserve", "capture"]);
  });

  it("a crashed job that is retried from the start charges exactly once", async () => {
    const lead = await addLead(wsB, campaign, "crash@x.nl");
    const before = await balance(wsB);
    // Attempt 1: reserve, then the worker dies before settling.
    expect((await db.query<{ ok: boolean }>("select public.reserve_credits($1, 1) as ok", [lead])).rows[0].ok).toBe(true);
    // Attempt 2 runs the whole job again.
    expect((await db.query<{ ok: boolean }>("select public.reserve_credits($1, 1) as ok", [lead])).rows[0].ok).toBe(true);
    await db.query("select public.capture_credits($1, 1)", [lead]);
    // Attempt 2 also dies after capturing; attempt 3 settles again.
    await db.query("select public.reserve_credits($1, 1)", [lead]);
    await db.query("select public.capture_credits($1, 1)", [lead]);
    await db.query("select public.release_credits($1)", [lead]);
    expect(await ledgerFor(lead)).toEqual([
      { type: "reserve", amount: -1 },
      { type: "capture", amount: 1 },
    ]);
    const after = await balance(wsB);
    expect(after.available).toBe(before.available - 1);
    expect(after.spent).toBe(before.spent + 1);
    expect(after.reserved).toBe(before.reserved);
  });

  it("a lead can only ever have one reserve row", async () => {
    const lead = await addLead(wsB, campaign, "uniq@x.nl");
    await db.query("select public.reserve_credits($1, 1)", [lead]);
    await expect(
      db.query("insert into public.credit_ledger (workspace_id, type, amount, lead_id) values ($1, 'reserve', -1, $2)", [wsB, lead]),
    ).rejects.toThrow(/credit_ledger_one_reserve_per_lead/);
  });

  it("capture and release refuse leads that were never reserved", async () => {
    const lead = await addLead(wsB, campaign, "never@x.nl");
    await expect(db.query("select public.capture_credits($1, 1)", [lead])).rejects.toThrow(/no reservation/);
    await expect(db.query("select public.release_credits($1)", [lead])).rejects.toThrow(/no reservation/);
    // Even a direct insert (buggy server code) is blocked by the table itself.
    await expect(
      db.query("insert into public.credit_ledger (workspace_id, type, amount, lead_id) values ($1, 'capture', 1, $2)", [wsB, lead]),
    ).rejects.toThrow(/no reservation/);
  });

  it("capture + release can never exceed the reserve, even via direct inserts", async () => {
    const lead = await addLead(wsB, campaign, "over@x.nl");
    await db.query("select public.reserve_credits($1, 2)", [lead]);
    await db.query("select public.capture_credits($1, 1)", [lead]);
    await expect(
      db.query("insert into public.credit_ledger (workspace_id, type, amount, lead_id) values ($1, 'release', 2, $2)", [wsB, lead]),
    ).rejects.toThrow(/would exceed the reservation/);
    expect((await db.query<{ n: number }>("select public.capture_credits($1, 5) as n", [lead])).rows[0].n).toBe(1);
  });

  it("settlement rows must belong to the reserve's workspace", async () => {
    const lead = await addLead(wsB, campaign, "wrongws@x.nl");
    await db.query("select public.reserve_credits($1, 1)", [lead]);
    await expect(
      db.query("insert into public.credit_ledger (workspace_id, type, amount, lead_id) values ($1, 'capture', 1, $2)", [wsA, lead]),
    ).rejects.toThrow(/does not match/);
  });

  it("reserve, capture and release rows must name a lead", async () => {
    await expect(
      db.query("insert into public.credit_ledger (workspace_id, type, amount) values ($1, 'reserve', -1)", [wsB]),
    ).rejects.toThrow(/credit_ledger_lead_required/);
  });

  it("reserve fails cleanly when credits run out, without writing anything", async () => {
    const { available } = await balance(wsB);
    const lead = await addLead(wsB, campaign, "broke@x.nl");
    const r = await db.query<{ ok: boolean }>("select public.reserve_credits($1, $2) as ok", [lead, available + 1]);
    expect(r.rows[0].ok).toBe(false);
    expect(await ledgerFor(lead)).toEqual([]);
  });

  it("balances always satisfy the agreed formulas", async () => {
    const raw = await db.query<{ type: string; total: number }>(
      "select type, sum(amount)::int as total from public.credit_ledger where workspace_id = $1 group by type",
      [wsB],
    );
    const t = Object.fromEntries(raw.rows.map((r) => [r.type, r.total])) as Record<string, number>;
    const g = (k: string) => t[k] ?? 0;
    const reserveMagnitude = -g("reserve");
    expect(await balance(wsB)).toEqual({
      available: g("purchase") + g("bonus") + g("refund") + g("release") - reserveMagnitude,
      reserved: reserveMagnitude - g("release") - g("capture"),
      spent: g("capture"),
    });
  });
});
