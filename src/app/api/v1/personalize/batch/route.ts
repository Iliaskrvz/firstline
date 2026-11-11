// POST /api/v1/personalize/batch: personalise up to 100 leads. See /docs/api.
import type { NextRequest } from "next/server";
import { personalizeBatch } from "@/api/handlers";
import { apiDeps, toApiRequest, toResponse } from "@/server/api";

export async function POST(request: NextRequest) {
  return toResponse(await personalizeBatch(apiDeps(), await toApiRequest(request, true)));
}
