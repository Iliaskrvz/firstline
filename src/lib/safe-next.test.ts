import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("after sign-in, only go to a path on this site", () => {
  it("keeps normal paths", () => {
    expect(safeNext("/campaigns/abc?tab=leads")).toBe("/campaigns/abc?tab=leads");
    expect(safeNext("/invite/xyz")).toBe("/invite/xyz");
  });

  it("refuses other sites, backslash tricks and control characters", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "/\\/evil.com", "https://evil.com", "evil.com", "/\tevil", "/%0d", null, ""]) {
      expect(safeNext(bad as string | null), String(bad)).toBe(bad === "/%0d" ? "/%0d" : "/campaigns");
    }
  });
});
