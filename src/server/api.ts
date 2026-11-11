// Next.js glue for /api/v1: Request → ApiRequest, ApiResponse → Response, real queue and pool.
import "server-only";
import type { NextRequest } from "next/server";
import type { ApiDeps, ApiRequest, ApiResponse } from "@/api/handlers";
import { serverPool } from "@/server/db";
import { enqueueLeads } from "@/server/queue";

export function apiDeps(): ApiDeps {
  return {
    pool: serverPool(),
    enqueue: async (leads, runId) => {
      await enqueueLeads(leads.map((l) => ({ ...l, preview: false, force: false })), runId);
    },
  };
}

export async function toApiRequest(request: NextRequest, withBody = false): Promise<ApiRequest> {
  return {
    headers: request.headers,
    body: withBody ? await request.text() : undefined,
    query: Object.fromEntries(request.nextUrl.searchParams),
  };
}

export function toResponse(r: ApiResponse): Response {
  return Response.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store", ...r.headers } });
}
