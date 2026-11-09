import { describe, expect, it } from "vitest";
import { assertEnv, missingEnv, missingEnvMessage } from "./env";

describe("env checks", () => {
  const full = {
    NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    ANTHROPIC_API_KEY: "sk-ant-x",
    FIRECRAWL_API_KEY: "fc-x",
  };

  it("finds missing and blank keys", () => {
    expect(missingEnv(full, ["app", "engine"])).toEqual([]);
    expect(missingEnv({ ...full, ANTHROPIC_API_KEY: "  ", FIRECRAWL_API_KEY: undefined }, ["engine"])).toEqual([
      "ANTHROPIC_API_KEY",
      "FIRECRAWL_API_KEY",
    ]);
    expect(missingEnv({}, ["app"])).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
  });

  it("explains where to get each key", () => {
    expect(missingEnvMessage(["FIRECRAWL_API_KEY"])).toContain("firecrawl.dev → Dashboard → API Keys");
  });

  it("assertEnv throws a clear error", () => {
    expect(() => assertEnv(["engine"], { ...full, ANTHROPIC_API_KEY: "" })).toThrow(/ANTHROPIC_API_KEY.*console\.anthropic\.com/);
    expect(() => assertEnv(["app", "engine"], full)).not.toThrow();
  });
});
