// Outbound webhooks (Phase 9): job.completed and batch.completed, signed and retried.
// Signature header: FirstLine-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
// with the endpoint's secret (shown once when the endpoint is created).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";

export const WEBHOOK_EVENTS = ["job.completed", "batch.completed"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
/** Wait before attempt 2, 3, …: 1 min, 5 min, 30 min, 2 h, 6 h, 24 h; then give up. */
export const RETRY_DELAYS_S = [60, 300, 1800, 7200, 21_600, 86_400];
export const SIGNATURE_TOLERANCE_S = 300;

export function signPayload(secret: string, body: string, t: number): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** For receivers (and our docs/tests): check a FirstLine-Signature header. */
export function verifySignature(secret: string, body: string, header: string | null, now = Math.floor(Date.now() / 1000)): boolean {
  const m = header?.match(/t=(\d+),v1=([0-9a-f]{64})/);
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(now - t) > SIGNATURE_TOLERANCE_S) return false;
  const want = Buffer.from(signPayload(secret, body, t).split("v1=")[1], "hex");
  const got = Buffer.from(m[2], "hex");
  return want.length === got.length && timingSafeEqual(want, got);
}

export type EndpointRow = { id: string; url: string; events: string[]; active: boolean; created_at: Date };

export function validEndpointUrl(url: string, allowHttp = false): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "Enter a full URL, starting with https://";
  }
  if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) return "The URL must start with https://";
  if (!allowHttp && /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\])/.test(u.hostname)) return "The URL must be reachable from the internet.";
  return null;
}

export async function createEndpoint(pool: pg.Pool, key: Buffer, workspaceId: string, url: string, events: WebhookEvent[]): Promise<{ row: EndpointRow; secret: string }> {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const { rows } = await pool.query<EndpointRow>(
    "insert into public.webhook_endpoints (workspace_id, url, secret_encrypted, events) values ($1, $2, $3, $4) returning id, url, events, active, created_at",
    [workspaceId, url, encryptSecret(secret, key), events],
  );
  return { row: rows[0], secret };
}

export async function listEndpoints(pool: pg.Pool, workspaceId: string) {
  const { rows } = await pool.query<EndpointRow & { delivered: number; failed: number; last_error: string | null }>(
    `select e.id, e.url, e.events, e.active, e.created_at,
            (select count(*)::int from public.webhook_deliveries d where d.endpoint_id = e.id and d.status = 'delivered') delivered,
            (select count(*)::int from public.webhook_deliveries d where d.endpoint_id = e.id and d.status = 'failed') failed,
            (select d.last_error from public.webhook_deliveries d where d.endpoint_id = e.id and d.last_error is not null order by d.created_at desc limit 1) last_error
       from public.webhook_endpoints e where e.workspace_id = $1 order by e.created_at`,
    [workspaceId],
  );
  return rows;
}

export async function deleteEndpoint(pool: pg.Pool, workspaceId: string, id: string): Promise<boolean> {
  const r = await pool.query("delete from public.webhook_endpoints where id = $1 and workspace_id = $2", [id, workspaceId]);
  return (r.rowCount ?? 0) > 0;
}

/** One delivery per active endpoint that wants this event (once per event id). */
export async function enqueueWebhookEvent(pool: pg.Pool, workspaceId: string, event: WebhookEvent, eventId: string, data: unknown): Promise<number> {
  const payload = { id: `evt_${eventId}`, type: event, created: new Date().toISOString(), data };
  const r = await pool.query(
    `insert into public.webhook_deliveries (endpoint_id, workspace_id, event, event_id, payload)
     select e.id, e.workspace_id, $2, $3, $4 from public.webhook_endpoints e
      where e.workspace_id = $1 and e.active and $2 = any(e.events)
     on conflict (endpoint_id, event, event_id) do nothing`,
    [workspaceId, event, eventId, JSON.stringify(payload)],
  );
  return r.rowCount ?? 0;
}

export type Poster = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number }>;

/** Send due deliveries. A 2xx answer within 10 seconds counts as delivered; anything else is retried later. */
export async function deliverDue(pool: pg.Pool, key: Buffer, post: Poster, now = new Date(), limit = 50): Promise<{ delivered: number; retried: number; failed: number }> {
  const out = { delivered: 0, retried: 0, failed: 0 };
  const c = await pool.connect();
  let due: { id: string; url: string; secret_encrypted: string; payload: unknown; attempts: number }[];
  try {
    await c.query("begin");
    const r = await c.query(
      `select d.id, e.url, e.secret_encrypted, d.payload, d.attempts
         from public.webhook_deliveries d join public.webhook_endpoints e on e.id = d.endpoint_id
        where d.status = 'pending' and d.next_attempt_at <= $1::timestamptz + interval '1 millisecond'
        order by d.next_attempt_at limit $2
        for update of d skip locked`,
      [now, limit],
    );
    due = r.rows;
    // Claim them for 2 minutes so a second worker doesn't send the same delivery at the same time.
    if (due.length) await c.query("update public.webhook_deliveries set next_attempt_at = $2 where id = any($1)", [due.map((d) => d.id), new Date(now.getTime() + 120_000)]);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }

  for (const d of due) {
    const body = JSON.stringify(d.payload);
    const t = Math.floor(now.getTime() / 1000);
    let status = 0;
    let error: string | null = null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await post(d.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "FirstLine-Webhooks/1", "FirstLine-Signature": signPayload(decryptSecret(d.secret_encrypted, key), body, t) },
        body,
        signal: ctrl.signal,
      });
      status = res.status;
      if (status < 200 || status >= 300) error = `HTTP ${status}`;
    } catch (e) {
      error = (e as Error).name === "AbortError" ? "No answer within 10 seconds" : "Could not connect";
    } finally {
      clearTimeout(timer);
    }
    const attempts = d.attempts + 1;
    if (!error) {
      await pool.query("update public.webhook_deliveries set status = 'delivered', attempts = $2, last_status = $3, last_error = null, delivered_at = now() where id = $1", [d.id, attempts, status]);
      out.delivered++;
    } else if (attempts > RETRY_DELAYS_S.length) {
      await pool.query("update public.webhook_deliveries set status = 'failed', attempts = $2, last_status = $3, last_error = $4 where id = $1", [d.id, attempts, status || null, error]);
      out.failed++;
    } else {
      await pool.query("update public.webhook_deliveries set attempts = $2, last_status = $3, last_error = $4, next_attempt_at = $5 where id = $1", [
        d.id,
        attempts,
        status || null,
        error,
        new Date(now.getTime() + RETRY_DELAYS_S[attempts - 1] * 1000),
      ]);
      out.retried++;
    }
  }
  return out;
}
