// GET /api/v1/jobs/{id}?wait=0..60: a job and its results. See /docs/api.
import type { NextRequest } from "next/server";
import { getJob } from "@/api/handlers";
import { apiDeps, toApiRequest, toResponse } from "@/server/api";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/v1/jobs/[id]">) {
  const { id } = await ctx.params;
  return toResponse(await getJob(apiDeps(), await toApiRequest(request), id));
}
