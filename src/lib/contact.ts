// "Talk to us" requests from /agencies: checking the form, limits, storage, the notification email,
// and cleanup. Framework-free so it's tested on a real Postgres.
import type pg from "pg";

export const CONTACT_PER_IP_PER_DAY = 3;
export const CONTACT_DAILY_CAP = 50;
export const CONTACT_RETENTION_DAYS = 180;

export const CONTACT_VOLUMES = ["Under 2,000", "2,000 to 10,000", "10,000 to 50,000", "More than 50,000", "Not sure yet"] as const;

export type ContactInput = { name: string; email: string; company: string; volume: string; message: string };
export type ContactField = keyof ContactInput;

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;
const oneLine = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * Check a submitted form. `website` is a hidden field people never see: when it's filled in, a bot
 * filled the form, and the request is quietly dropped (`spam`).
 */
export function parseContact(body: Record<string, unknown>): { ok: true; value: ContactInput } | { ok: false; field: ContactField | null; spam?: true } {
  if (typeof body.website === "string" && body.website.trim()) return { ok: false, field: null, spam: true };
  const name = oneLine(body.name, 120);
  const email = oneLine(body.email, 254).toLowerCase();
  const company = oneLine(body.company, 160);
  const volume = (CONTACT_VOLUMES as readonly string[]).includes(body.volume as string) ? (body.volume as string) : "";
  const message = typeof body.message === "string" ? body.message.replace(/\r\n/g, "\n").trim().slice(0, 4000) : "";
  if (!name) return { ok: false, field: "name" };
  if (!EMAIL.test(email)) return { ok: false, field: "email" };
  if (!volume) return { ok: false, field: "volume" };
  return { ok: true, value: { name, email, company, volume, message } };
}

const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Store a request if this IP and the whole site are under today's limits (checked and inserted under one lock). */
export async function admitContact(
  pool: pg.Pool,
  input: ContactInput & { ipHash: string; now?: Date; perIp?: number; cap?: number },
): Promise<{ ok: true; id: number } | { ok: false; reason: "ip_limit" | "daily_cap" }> {
  const now = input.now ?? new Date();
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(hashtext('contact-requests'))");
    const { rows } = await c.query<{ ip: number; total: number }>(
      "select count(*) filter (where ip_hash = $2)::int ip, count(*)::int total from public.contact_requests where created_at >= $1",
      [dayStart(now), input.ipHash],
    );
    if (rows[0].ip >= (input.perIp ?? CONTACT_PER_IP_PER_DAY)) {
      await c.query("rollback");
      return { ok: false, reason: "ip_limit" };
    }
    if (rows[0].total >= (input.cap ?? CONTACT_DAILY_CAP)) {
      await c.query("rollback");
      return { ok: false, reason: "daily_cap" };
    }
    const ins = await c.query<{ id: string }>(
      `insert into public.contact_requests (name, email, company, volume, message, ip_hash, created_at)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [input.name, input.email, input.company, input.volume, input.message, input.ipHash, now],
    );
    await c.query("commit");
    return { ok: true, id: Number(ins.rows[0].id) };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function markContactNotified(pool: pg.Pool, id: number, now = new Date()) {
  await pool.query("update public.contact_requests set notified_at = $2 where id = $1", [id, now]);
}

export type ContactRow = ContactInput & { id: number; createdAt: Date; notified: boolean };

/** The latest requests, for /admin (so nothing is missed when email isn't set up). */
export async function recentContacts(pool: pg.Pool, limit = 10): Promise<ContactRow[]> {
  const { rows } = await pool.query(
    "select id, name, email, company, volume, message, created_at, notified_at from public.contact_requests order by created_at desc limit $1",
    [limit],
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name, email: r.email, company: r.company, volume: r.volume, message: r.message, createdAt: r.created_at, notified: !!r.notified_at }));
}

/** Requests older than the retention period are deleted (worker retention job). */
export async function purgeContacts(pool: pg.Pool, now = new Date(), days = CONTACT_RETENTION_DAYS): Promise<number> {
  const r = await pool.query("delete from public.contact_requests where created_at < $1::timestamptz - make_interval(days => $2)", [now, days]);
  return r.rowCount ?? 0;
}

/** The email to the owner about a new request. Plain text; the visitor's address goes in reply-to. */
export function contactNotification(c: ContactInput, appUrl: string | null) {
  return {
    subject: `FirstLine: ${c.company || c.name} wants to talk (${c.volume})`,
    text: [
      "New request from the agencies page.",
      "",
      `Name: ${c.name}`,
      `Email: ${c.email}`,
      `Company: ${c.company || "-"}`,
      `Emails a month: ${c.volume}`,
      "",
      c.message || "(no message)",
      "",
      appUrl ? `All requests: ${appUrl}/admin` : "All requests are listed on /admin.",
      "Reply to this email to answer them directly.",
    ].join("\n"),
  };
}
