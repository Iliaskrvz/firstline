// Environment checks. Pure, so they can be tested; called once at startup.

export const ENV_GROUPS = {
  /** Needed for the web app to run at all. */
  app: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
  /** Website research. */
  firecrawl: ["FIRECRAWL_API_KEY"],
  /** The pg-boss queue + the worker's database writes (Supabase session pooler string). */
  database: ["DATABASE_URL"],
  /** Only needed when LLM_PROVIDER=anthropic. Without it, AI steps report "Anthropic key missing". */
  anthropic: ["ANTHROPIC_API_KEY"],
} as const;

export type EnvGroup = keyof typeof ENV_GROUPS;

export function missingEnv(env: Record<string, string | undefined>, groups: EnvGroup[]): string[] {
  return groups.flatMap((g) => ENV_GROUPS[g]).filter((k) => !env[k]?.trim());
}

const WHERE: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "Supabase → Project Settings → API → Project URL",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "Supabase → Project Settings → API Keys → publishable key",
  ANTHROPIC_API_KEY: "console.anthropic.com → Settings → API Keys",
  FIRECRAWL_API_KEY: "firecrawl.dev → Dashboard → API Keys",
  DATABASE_URL: "Supabase → Connect → Session pooler (port 5432), with your database password",
};

export function missingEnvMessage(missing: string[]): string {
  return [
    `Missing environment variable${missing.length > 1 ? "s" : ""} in .env.local:`,
    ...missing.map((k) => `  - ${k}  (get it at: ${WHERE[k] ?? "see .env.example"})`),
    "Copy .env.example to .env.local, fill these in, and restart.",
  ].join("\n");
}

/** Throws a clear error if any variable in the given groups is missing. */
export function assertEnv(groups: EnvGroup[], env: Record<string, string | undefined> = process.env): void {
  const missing = missingEnv(env, groups);
  if (missing.length) throw new Error(missingEnvMessage(missing));
}
