// POST /api/sender/report: what happened to a handed-out email, plus replies and
// bounces the script found. Only status flags arrive here, never email content (§8).
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { looksLikeSenderKey } from "@/lib/sender/messages";
import { serverPool } from "@/server/db";
import { queueConfigured } from "@/server/queue";
import { SenderAuthError, senderReport } from "@/sender/db";

const NO_STORE = { "cache-control": "no-store" };

const Report = z.object({
  send: z
    .object({
      send_id: z.uuid(),
      status: z.enum(["sent", "failed"]),
      thread_id: z.string().max(200).nullish(),
      error: z.string().max(1000).nullish(),
    })
    .optional(),
  events: z
    .array(z.object({ send_id: z.uuid(), type: z.enum(["replied", "bounced"]), unsubscribe: z.boolean().optional() }))
    .max(100)
    .optional(),
});

export async function POST(request: NextRequest) {
  const key = request.headers.get("x-firstline-key");
  if (!looksLikeSenderKey(key)) return NextResponse.json({ error: "Missing or malformed sender key." }, { status: 401, headers: NO_STORE });
  if (!queueConfigured()) return NextResponse.json({ error: "FirstLine isn't configured for sending yet." }, { status: 503, headers: NO_STORE });
  const parsed = Report.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid report." }, { status: 400, headers: NO_STORE });
  try {
    return NextResponse.json(await senderReport(serverPool(), key, parsed.data), { headers: NO_STORE });
  } catch (e) {
    if (e instanceof SenderAuthError) return NextResponse.json({ error: e.message }, { status: 401, headers: NO_STORE });
    console.error("sender/report:", (e as Error).message);
    return NextResponse.json({ error: "Something went wrong on our side. The script will try again." }, { status: 500, headers: NO_STORE });
  }
}
