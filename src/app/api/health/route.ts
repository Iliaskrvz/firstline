// GET /api/health: for an uptime monitor. 200 when the app answers and the database responds, else 503.
// Says nothing about the setup beyond "ok" or "down".
import { NextResponse } from "next/server";
import { connection } from "next/server";
import { serverPool } from "@/server/db";

export async function GET() {
  await connection();
  try {
    await Promise.race([serverPool().query("select 1"), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 3_000))]);
    return NextResponse.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "down" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
