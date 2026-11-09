// The server's own database connection (Supabase session pooler, DATABASE_URL).
// Used where there is no signed-in user, like the sender API. Server only.
import "server-only";
import pg from "pg";
import { dbConnection } from "@/lib/queue";

let pool: pg.Pool | null = null;

export function serverPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ ...dbConnection(process.env.DATABASE_URL!), max: 5, idleTimeoutMillis: 30_000 });
    pool.on("error", (e) => console.error("db pool:", e.message));
  }
  return pool;
}
