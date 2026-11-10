// The setup steps build the code in the browser: prove it works without Node's Buffer.
import { describe, expect, it } from "vitest";
import { connectionCode, parseConnectionCode } from "./connection";

function withoutBuffer<T>(fn: () => T): T {
  const g = globalThis as { Buffer?: unknown };
  const saved = g.Buffer;
  delete g.Buffer;
  try {
    return fn();
  } finally {
    g.Buffer = saved;
  }
}

describe("connection code", () => {
  it("round-trips the address and key, without Node's Buffer (browser)", () => {
    const key = "fl_" + "A1-_".repeat(12);
    const code = withoutBuffer(() => connectionCode("https://firstline.46-17-99-33.sslip.io/", key));
    expect(code).toBe(`FL1.aHR0cHM6Ly9maXJzdGxpbmUuNDYtMTctOTktMzMuc3NsaXAuaW8.${key}`);
    expect(withoutBuffer(() => parseConnectionCode(code))).toEqual({ base: "https://firstline.46-17-99-33.sslip.io", key });
    expect(parseConnectionCode(connectionCode("https://exämple.nl", key))?.base).toBe("https://exämple.nl");
    expect(parseConnectionCode("FL1.@@@." + key)).toBeNull();
    expect(parseConnectionCode("fl_" + "a".repeat(43))).toBeNull();
  });
});
