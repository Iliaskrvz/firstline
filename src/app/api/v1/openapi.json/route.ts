// GET /api/v1/openapi.json: the OpenAPI 3.1 description (public).
import { openApiSpec } from "@/api/openapi";
import { publicAppUrl } from "@/server/sender-view";

export function GET() {
  return Response.json(openApiSpec(publicAppUrl() ?? "https://firstline.example"), { headers: { "Cache-Control": "public, max-age=300" } });
}
