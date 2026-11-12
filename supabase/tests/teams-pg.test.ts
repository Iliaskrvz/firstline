// Integration: teams on a real Postgres 17 (embedded). Invites, roles, removal, ownership transfer,
// and RLS for every new table: a member sees their workspace and nothing else, a removed member
// loses access at once, only admins change integrations, and Lite credits only pay for Lite runs.
import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reserveForRun } from "@/billing/db";
import { acceptInvite, activity, changeRole, invite, inviteByToken, logActivity, members, membershipsOf, removeMember, roleOf, TeamError, transferOwnership } from "@/teams/db";

const root = path.resolve(__dirname, "..");
const OWNER = "00000000-0000-0000-0000-00000000aa01";
const ADMIN = "00000000-0000-0000-0000-00000000aa02";
const MEMBER = "00000000-0000-0000-0000-00000000aa03";
const STRANGER = "00000000-0000-0000-0000-00000000aa04";

let server: EmbeddedPostgres;
let pool: pg.Pool;
let dir: string;
let ws: string;
let strangerWs: string;

/** Run queries as a signed-in user with RLS, like the browser's Supabase client. */
async function asUser<T>(userId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return await fn(c);
  } finally {
    await c.query("rollback").catch(() => {});
    c.release();
  }
}
const count = async (userId: string, sql: string, params: unknown[] = []) => asUser(userId, async (c) => (await c.query(sql, params)).rowCount ?? 0);

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "firstline-teams-"));
  const port = 43_000 + Math.floor(Math.random() * 1_000);
  server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "test", port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "test", database: "postgres", max: 10 });
  await pool.query(readFileSync(path.join(root, "tests/supabase-shim.sql"), "utf8"));
  for (const f of readdirSync(path.join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(path.join(root, "migrations", f), "utf8"));
  }
  for (const [id, email] of [
    [OWNER, "owner@agency.nl"],
    [ADMIN, "Admin@Agency.nl"],
    [MEMBER, "member@agency.nl"],
    [STRANGER, "stranger@other.nl"],
  ]) {
    await pool.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  }
  ws = (await pool.query("select id from public.workspaces where owner_id = $1", [OWNER])).rows[0].id;
  strangerWs = (await pool.query("select id from public.workspaces where owner_id = $1", [STRANGER])).rows[0].id;
  await pool.query("insert into public.campaigns (workspace_id, name) values ($1, 'Agency campaign'), ($2, 'Stranger campaign')", [ws, strangerWs]);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("invites", () => {
  let adminToken = "";

  it("owners invite; the link only works for the invited address, once", async () => {
    adminToken = (await invite(pool, { workspaceId: ws, actor: { id: OWNER, role: "owner" }, email: "admin@agency.nl", role: "admin" })).token;
    const memberToken = (await invite(pool, { workspaceId: ws, actor: { id: OWNER, role: "owner" }, email: "member@agency.nl", role: "member" })).token;
    expect(await inviteByToken(pool, adminToken)).toMatchObject({ workspace_name: expect.any(String), email: "admin@agency.nl", role: "admin", status: "open" });

    await expect(acceptInvite(pool, adminToken, { id: STRANGER, email: "stranger@other.nl" })).rejects.toThrow(/This invite is for admin@agency.nl/);
    expect(await acceptInvite(pool, adminToken, { id: ADMIN, email: "ADMIN@agency.nl" })).toEqual({ workspaceId: ws, role: "admin" });
    await expect(acceptInvite(pool, adminToken, { id: ADMIN, email: "admin@agency.nl" })).rejects.toThrow(/already used/);
    await acceptInvite(pool, memberToken, { id: MEMBER, email: "member@agency.nl" });
    expect((await members(pool, ws)).map((m) => [m.email.toLowerCase(), m.role])).toEqual([
      ["owner@agency.nl", "owner"],
      ["admin@agency.nl", "admin"],
      ["member@agency.nl", "member"],
    ]);
    // Their own workspace stays: two memberships to switch between.
    expect((await membershipsOf(pool, MEMBER)).map((m) => m.role)).toEqual(["owner", "member"]);
  });

  it("members can't invite; a new invite replaces the old link; expired links fail", async () => {
    await expect(invite(pool, { workspaceId: ws, actor: { id: MEMBER, role: "member" }, email: "x@y.nl", role: "member" })).rejects.toBeInstanceOf(TeamError);
    await expect(invite(pool, { workspaceId: ws, actor: { id: OWNER, role: "owner" }, email: "member@agency.nl", role: "member" })).rejects.toThrow(/already in this workspace/);
    const first = (await invite(pool, { workspaceId: ws, actor: { id: ADMIN, role: "admin" }, email: "new@agency.nl", role: "member" })).token;
    const second = (await invite(pool, { workspaceId: ws, actor: { id: ADMIN, role: "admin" }, email: "new@agency.nl", role: "member" })).token;
    expect((await inviteByToken(pool, first))?.status).toBe("revoked");
    await pool.query("update public.workspace_invites set expires_at = now() - interval '1 minute' where email = 'new@agency.nl' and revoked_at is null");
    expect((await inviteByToken(pool, second))?.status).toBe("expired");
    await expect(acceptInvite(pool, second, { id: STRANGER, email: "new@agency.nl" })).rejects.toThrow(/expired/);
  });
});

describe("RLS for teams", () => {
  it("members see their workspace's campaigns and members, nothing of others", async () => {
    expect(await count(MEMBER, "select 1 from public.campaigns where workspace_id = $1", [ws])).toBe(1);
    expect(await count(MEMBER, "select 1 from public.campaigns where workspace_id = $1", [strangerWs])).toBe(0);
    expect(await count(STRANGER, "select 1 from public.campaigns where workspace_id = $1", [ws])).toBe(0);
    expect(await count(MEMBER, "select 1 from public.workspace_members where workspace_id = $1", [ws])).toBe(3);
    expect(await count(STRANGER, "select 1 from public.workspace_members where workspace_id = $1", [ws])).toBe(0);
  });

  it("invites, slots, provider limits and API keys are server-only", async () => {
    for (const t of ["workspace_invites", "workspace_slots", "provider_slots", "provider_windows", "api_keys", "api_jobs", "webhook_endpoints"]) {
      expect(await count(OWNER, `select 1 from public.${t}`), t).toBe(0);
    }
  });

  it("only owners and admins change integrations; members only see them", async () => {
    // Keys are never written from the browser at all (column grants); the server saves them encrypted.
    await expect(asUser(ADMIN, (c) => c.query("insert into public.integrations (workspace_id, provider) values ($1, 'lemlist')", [ws]))).rejects.toThrow(/permission denied/);
    await pool.query("insert into public.integrations (workspace_id, provider) values ($1, 'smartlead')", [ws]);
    const upd = (u: string) => asUser(u, async (c) => (await c.query("update public.integrations set auto_rules = '{\"x\":1}' where workspace_id = $1", [ws])).rowCount);
    expect(await upd(MEMBER)).toBe(0);
    expect(await upd(ADMIN)).toBe(1);
    expect(await count(MEMBER, "select id from public.integrations where workspace_id = $1", [ws])).toBe(1);
    expect(await count(STRANGER, "select id from public.integrations where workspace_id = $1", [ws])).toBe(0);
    const del = await asUser(MEMBER, (c) => c.query("delete from public.integrations where workspace_id = $1", [ws]));
    expect(del.rowCount).toBe(0);
  });

  it("the activity log is readable by members only, and nobody writes it from the browser", async () => {
    await logActivity(pool, { workspaceId: ws, userId: OWNER, actor: "owner@agency.nl", action: "campaign.run", target: "Agency campaign" });
    expect(await count(MEMBER, "select 1 from public.activity_log where workspace_id = $1", [ws])).toBe(1);
    expect(await count(STRANGER, "select 1 from public.activity_log where workspace_id = $1", [ws])).toBe(0);
    await expect(asUser(MEMBER, (c) => c.query("insert into public.activity_log (workspace_id, actor, action) values ($1, 'x', 'y')", [ws]))).rejects.toThrow(/permission denied/);
    expect((await activity(pool, ws))[0]).toMatchObject({ actor: "owner@agency.nl", action: "campaign.run", target: "Agency campaign" });
  });

  it("a removed member loses access at once", async () => {
    await expect(removeMember(pool, { workspaceId: ws, actor: { id: ADMIN, role: "admin" }, userId: OWNER })).rejects.toThrow(/owner can't be removed/);
    await removeMember(pool, { workspaceId: ws, actor: { id: ADMIN, role: "admin" }, userId: MEMBER });
    expect(await count(MEMBER, "select 1 from public.campaigns where workspace_id = $1", [ws])).toBe(0);
    expect(await count(MEMBER, "select 1 from public.activity_log where workspace_id = $1", [ws])).toBe(0);
    expect(await roleOf(pool, ws, MEMBER)).toBeNull();
  });
});

describe("roles and ownership", () => {
  it("only the owner changes roles, and transfers ownership to a member", async () => {
    await expect(changeRole(pool, { workspaceId: ws, actor: { id: ADMIN, role: "admin" }, userId: OWNER, role: "member" })).rejects.toBeInstanceOf(TeamError);
    await changeRole(pool, { workspaceId: ws, actor: { id: OWNER, role: "owner" }, userId: ADMIN, role: "member" });
    expect(await roleOf(pool, ws, ADMIN)).toBe("member");
    await expect(transferOwnership(pool, { workspaceId: ws, actor: { id: ADMIN, role: "member" }, toUserId: ADMIN })).rejects.toBeInstanceOf(TeamError);
    await expect(transferOwnership(pool, { workspaceId: ws, actor: { id: OWNER, role: "owner" }, toUserId: STRANGER })).rejects.toBeInstanceOf(TeamError);
    await transferOwnership(pool, { workspaceId: ws, actor: { id: OWNER, role: "owner" }, toUserId: ADMIN });
    expect([await roleOf(pool, ws, ADMIN), await roleOf(pool, ws, OWNER)]).toEqual(["owner", "admin"]);
    expect((await pool.query("select owner_id from public.workspaces where id = $1", [ws])).rows[0].owner_id).toBe(ADMIN);
    expect((await pool.query("select count(*)::int n from public.workspace_members where workspace_id = $1 and role = 'owner'", [ws])).rows[0].n).toBe(1);
  });
});

describe("Lite credits", () => {
  async function campaign(writer: "pro" | "lite", n: number) {
    const c = (await pool.query("insert into public.campaigns (workspace_id, name, writer) values ($1, $2, $3) returning id", [strangerWs, `${writer} run`, writer])).rows[0].id;
    const leads: string[] = [];
    for (let i = 0; i < n; i++) {
      leads.push((await pool.query("insert into public.leads (workspace_id, campaign_id, email, domain) values ($1, $2, $3, 'x.nl') returning id", [strangerWs, c, `${writer}${i}@x.nl`])).rows[0].id);
    }
    return leads;
  }
  const bal = async () => (await pool.query("select available, lite_available, reserved, purchased from public.workspace_balance where workspace_id = $1", [strangerWs])).rows[0];

  it("Lite credits pay for Lite runs only; Pro runs use standard credits", async () => {
    await pool.query("select public.add_purchase($1, 3, 'test:lite', 'Lite pack', 'lite')", [strangerWs]);
    await pool.query("select public.add_purchase($1, 2, 'test:std', 'Starter pack')", [strangerWs]);
    expect(await bal()).toEqual({ available: 2, lite_available: 3, reserved: 0, purchased: 5 });

    const pro = await campaign("pro", 3);
    expect(await reserveForRun(pool, { workspaceId: strangerWs, leadIds: pro, perLead: 1 })).toMatchObject({ ok: false });
    expect(await bal()).toMatchObject({ available: 2, lite_available: 3, reserved: 0 });

    const lite = await campaign("lite", 4);
    expect(await reserveForRun(pool, { workspaceId: strangerWs, leadIds: lite, perLead: 1 })).toMatchObject({ ok: true, reserved: 4 });
    // 3 from Lite credits, the 4th from standard ones.
    const kinds = (await pool.query("select kind, count(*)::int n from public.credit_ledger where lead_id = any($1) and type = 'reserve' group by kind order by kind", [lite])).rows;
    expect(kinds).toEqual([
      { kind: "lite", n: 3 },
      { kind: "standard", n: 1 },
    ]);
    expect(await bal()).toEqual({ available: 1, lite_available: 0, reserved: 4, purchased: 5 });

    // Capture and release follow the reserve's kind.
    await pool.query("select public.capture_credits($1, 1)", [lite[0]]);
    await pool.query("select public.release_credits($1)", [lite[3]]);
    expect(await bal()).toEqual({ available: 2, lite_available: 0, reserved: 2, purchased: 5 });
    const settled = (await pool.query("select type, kind from public.credit_ledger where lead_id = any($1) and type in ('capture', 'release') order by type", [[lite[0], lite[3]]])).rows;
    expect(settled).toEqual([
      { type: "capture", kind: "lite" },
      { type: "release", kind: "standard" },
    ]);
    await expect(pool.query("insert into public.credit_ledger (workspace_id, type, amount, lead_id, kind) values ($1, 'release', 1, $2, 'standard')", [strangerWs, lite[1]])).rejects.toThrow(
      /does not match the reservation/,
    );
  });
});
