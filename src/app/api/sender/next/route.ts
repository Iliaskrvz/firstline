// GET /api/sender/next: the Sender Sheet asks for at most one email (§8).
import { NextResponse, type NextRequest } from "next/server";
import { looksLikeSenderKey } from "@/lib/sender/messages";
import { serverPool } from "@/server/db";
import { queueConfigured } from "@/server/queue";
import { SenderAuthError, senderNext } from "@/sender/db";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: NextRequest) {
  const key = request.headers.get("x-firstline-key");
  if (!looksLikeSenderKey(key)) return NextResponse.json({ error: "Missing or malformed sender key." }, { status: 401, headers: NO_STORE });
  if (!queueConfigured()) return NextResponse.json({ error: "FirstLine isn't configured for sending yet." }, { status: 503, headers: NO_STORE });
  try {
    const res = await senderNext(serverPool(), key, {
      scriptVersion: request.headers.get("x-firstline-script"),
      peek: request.headers.get("x-firstline-peek") === "1",
    });
    return NextResponse.json(res, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof SenderAuthError) return NextResponse.json({ error: e.message }, { status: 401, headers: NO_STORE });
    console.error("sender/next:", (e as Error).message);
    return NextResponse.json({ error: "Something went wrong on our side. The script will try again." }, { status: 500, headers: NO_STORE });
  }
}
