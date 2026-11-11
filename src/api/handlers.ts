// /api/v1 request handling without Next.js: auth, rate limit, validation, idempotency, jobs, wait.
// Route files only translate Request ↔ ApiRequest/ApiResponse, so this is tested end to end.
import type pg from "pg";
import { balance } from "@/billing/db";
import { authenticate, createJob, jobView, rateLimit, requestHash, waitForJob, type ApiCaller, type JobView } from "./core-pg";
import { ApiError, invalid, notFound, unauthorized } from "./errors";
import { keyFromAuthHeader } from "./keys";
import { BatchBody, normaliseSource, PersonalizeBody, zodMessage } from "./schemas";

export type ApiDeps = {
  pool: pg.Pool;
  /** Queue the leads for the worker (pg-boss in production). */
  enqueue: (leads: { leadId: string; workspaceId: string }[], runId: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

export type ApiRequest = { headers: { get(name: string): string | null }; body?: string; query?: Record<string, string | undefined> };
export type ApiResponse = { status: number; body: unknown; headers: Record<string, string> };

const json = (status: number, body: unknown, headers: Record<string, string> = {}): ApiResponse => ({ status, body, headers });

async function caller(deps: ApiDeps, req: ApiRequest): Promise<{ who: ApiCaller; headers: Record<string, string> }> {
  const key = keyFromAuthHeader(req.headers.get("authorization"));
  if (!key) throw unauthorized();
  const who = await authenticate(deps.pool, key);
  if (!who) throw unauthorized();
  const headers = await rateLimit(deps.pool, who.apiKeyId, deps.now?.());
  return { who, headers };
}

function parseBody(raw: string | undefined): unknown {
  if (!raw) throw invalid("Send a JSON body.");
  if (raw.length > 1_000_000) throw invalid("The body is too large (max 1 MB).");
  try {
    return JSON.parse(raw);
  } catch {
    throw invalid("The body is not valid JSON.");
  }
}

/** For one lead: the result at the top level too, so n8n/Make can map it without digging. */
function present(view: JobView) {
  return view.kind === "single" ? { ...view, result: view.results[0] ?? null } : view;
}

async function run<T>(fn: () => Promise<T>): Promise<T | ApiResponse> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) return json(e.status, e.toBody(), e.headers);
    console.error("api error:", (e as Error).message);
    return json(500, { error: { code: "server_error", message: "Something went wrong on our side. Retry with the same Idempotency-Key." } });
  }
}

async function personalizeLike(deps: ApiDeps, req: ApiRequest, kind: "single" | "batch"): Promise<ApiResponse> {
  return (await run(async () => {
    const { who, headers } = await caller(deps, req);
    const raw = parseBody(req.body);
    const parsed = (kind === "single" ? PersonalizeBody : BatchBody).safeParse(normaliseSource(raw));
    if (!parsed.success) {
      const m = zodMessage(parsed.error);
      throw invalid(m.message, { field: m.field });
    }
    const data = parsed.data;
    const leads = "lead" in data ? [data.lead] : data.leads;
    const idem = req.headers.get("idempotency-key")?.trim() || null;
    if (idem && idem.length > 200) throw invalid("Idempotency-Key is too long (max 200 characters).");
    const job = await createJob(deps.pool, who, {
      kind,
      leads,
      source: { copy: data.copy, campaign_id: data.campaign_id, options: data.options },
      idempotencyKey: idem,
      requestHash: requestHash(raw),
    });
    if (job.leadIds.length) {
      try {
        await deps.enqueue(job.leadIds.map((leadId) => ({ leadId, workspaceId: who.workspaceId })), `api-${job.jobId}`);
      } catch {
        // The leads stay queued with their credits reserved; the job can be retried with the same Idempotency-Key.
        throw new ApiError(503, "server_error", "The job queue is unavailable right now. Retry with the same Idempotency-Key.");
      }
    }
    const view = data.wait > 0 ? await waitForJob(deps.pool, who.workspaceId, job.jobId, data.wait, deps.sleep) : await jobView(deps.pool, who.workspaceId, job.jobId);
    if (!view) throw notFound("Job not found");
    const location = `/api/v1/jobs/${view.id}`;
    return json(view.status === "done" ? 200 : 202, present(view), { ...headers, Location: location, ...(job.replayed ? { "Idempotent-Replayed": "true" } : {}) });
  })) as ApiResponse;
}

export const personalize = (deps: ApiDeps, req: ApiRequest) => personalizeLike(deps, req, "single");
export const personalizeBatch = (deps: ApiDeps, req: ApiRequest) => personalizeLike(deps, req, "batch");

export async function getJob(deps: ApiDeps, req: ApiRequest, jobId: string): Promise<ApiResponse> {
  return (await run(async () => {
    const { who, headers } = await caller(deps, req);
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw notFound("Job not found");
    const wait = Math.min(60, Math.max(0, Number(req.query?.wait ?? 0) || 0));
    const view = wait ? await waitForJob(deps.pool, who.workspaceId, jobId, wait, deps.sleep) : await jobView(deps.pool, who.workspaceId, jobId);
    if (!view) throw notFound("Job not found");
    return json(200, present(view), headers);
  })) as ApiResponse;
}

export async function getCredits(deps: ApiDeps, req: ApiRequest): Promise<ApiResponse> {
  return (await run(async () => {
    const { who, headers } = await caller(deps, req);
    const b = await balance(deps.pool, who.workspaceId);
    return json(200, { object: "credits", available: b.available, reserved: b.reserved }, headers);
  })) as ApiResponse;
}
