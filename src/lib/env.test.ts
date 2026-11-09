import { describe, expect, it } from "vitest";
import { assertEnv, isDatabaseUrl, missingEnv, missingEnvMessage } from "./env";

describe("env checks", () => {
  const full = {
    NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    ANTHROPIC_API_KEY: "sk-ant-x",
    FIRECRAWL_API_KEY: "fc-x",
  };

  it("finds missing and blank keys", () => {
    expect(missingEnv(full, ["app", "anthropic", "firecrawl"])).toEqual([]);
    expect(missingEnv({ ...full, ANTHROPIC_API_KEY: "  ", FIRECRAWL_API_KEY: undefined }, ["anthropic", "firecrawl"])).toEqual([
      "ANTHROPIC_API_KEY",
      "FIRECRAWL_API_KEY",
    ]);
    expect(missingEnv({}, ["app"])).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
  });

  it("explains where to get each key", () => {
    expect(missingEnvMessage(["FIRECRAWL_API_KEY"])).toContain("firecrawl.dev → Dashboard → API Keys");
  });

  it("assertEnv throws a clear error", () => {
    expect(() => assertEnv(["anthropic", "firecrawl"], { ...full, ANTHROPIC_API_KEY: "" })).toThrow(/ANTHROPIC_API_KEY.*console\.anthropic\.com/);
    expect(() => assertEnv(["app", "anthropic", "firecrawl"], full)).not.toThrow();
  });
});

describe("DATABASE_URL format", () => {
  it("accepts Postgres connection strings and rejects the https project URL", () => {
    expect(isDatabaseUrl("postgresql://postgres.ref:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres")).toBe(true);
    expect(isDatabaseUrl("postgres://u:p@localhost/db")).toBe(true);
    expect(isDatabaseUrl("https://abc.supabase.co")).toBe(false);
    expect(isDatabaseUrl("")).toBe(false);
    expect(missingEnv({ DATABASE_URL: "https://abc.supabase.co" }, ["database"])).toEqual(["DATABASE_URL"]);
    expect(missingEnvMessage(["DATABASE_URL"])).toContain("not https://");
  });
});
