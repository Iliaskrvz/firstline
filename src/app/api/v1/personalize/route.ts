// POST /api/v1/personalize: personalise one lead. See /docs/api.
import type { NextRequest } from "next/server";
import { personalize } from "@/api/handlers";
import { apiDeps, toApiRequest, toResponse } from "@/server/api";

export async function POST(request: NextRequest) {
  return toResponse(await personalize(apiDeps(), await toApiRequest(request, true)));
}
