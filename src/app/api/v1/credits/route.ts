// GET /api/v1/credits: the workspace's credit balance. See /docs/api.
import type { NextRequest } from "next/server";
import { getCredits } from "@/api/handlers";
import { apiDeps, toApiRequest, toResponse } from "@/server/api";

export async function GET(request: NextRequest) {
  return toResponse(await getCredits(apiDeps(), await toApiRequest(request)));
}
