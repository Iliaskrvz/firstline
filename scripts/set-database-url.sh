#!/usr/bin/env bash
# Writes DATABASE_URL to .env.local from the linked Supabase project's session pooler address
# (saved by `supabase link` in supabase/.temp/pooler-url) plus your database password.
# The password is read without echoing and never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f supabase/.temp/pooler-url ]; then
  echo "supabase/.temp/pooler-url not found. Run: npx supabase link --project-ref <ref>" >&2
  exit 1
fi

read -rsp "Supabase database password: " FIRSTLINE_DB_PASSWORD
echo
if [ -z "$FIRSTLINE_DB_PASSWORD" ]; then
  echo "No password entered, nothing changed." >&2
  exit 1
fi
export FIRSTLINE_DB_PASSWORD

node --input-type=module -e '
import fs from "node:fs";
const url = new URL(fs.readFileSync("supabase/.temp/pooler-url", "utf8").trim());
url.port = "5432"; // session pooler: pg-boss needs a session connection
url.password = encodeURIComponent(process.env.FIRSTLINE_DB_PASSWORD);
const file = ".env.local";
const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter((l) => !l.startsWith("DATABASE_URL=")) : [];
while (lines.length && lines[lines.length - 1] === "") lines.pop();
lines.push("DATABASE_URL=" + url.href);
fs.writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
'
unset FIRSTLINE_DB_PASSWORD

node --input-type=module -e '
import pg from "pg";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true, override: true });
const u = new URL(process.env.DATABASE_URL);
u.searchParams.delete("sslmode");
const c = new pg.Client({ connectionString: u.href, ssl: { rejectUnauthorized: false } });
try {
  await c.connect();
  await c.query("select 1");
  console.log("DATABASE_URL saved and the connection works.");
} catch (e) {
  console.log("DATABASE_URL saved, but connecting failed: " + e.message);
  console.log("Wrong password? Reset it in Supabase (Project Settings -> Database) and run this again.");
  process.exitCode = 1;
} finally {
  await c.end().catch(() => {});
}
'
