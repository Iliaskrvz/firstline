import { describe, expect, it } from "vitest";
import { availableFields, defaultVariableMap, validateVariableMap, variablesFor } from "./fields";

describe("variable mapping", () => {
  const map = defaultVariableMap(["opener", "ps"], [2]);
  const allowed = availableFields(["opener", "ps"], [2]).map((f) => f.field);

  it("defaults to the CSV export names", () => {
    expect(map).toEqual([
      { field: "subject", variable: "fl_subject" },
      { field: "slot:opener", variable: "fl_opener" },
      { field: "slot:ps", variable: "fl_ps" },
      { field: "full_email", variable: "fl_full_email" },
      { field: "followup:2", variable: "fl_followup_2" },
    ]);
    expect(validateVariableMap(map, allowed)).toBeNull();
  });

  it("rejects bad, reserved and duplicate names", () => {
    expect(validateVariableMap([{ field: "subject", variable: "" }], allowed)).toMatch(/at least one/);
    expect(validateVariableMap([{ field: "subject", variable: "1abc" }], allowed)).toMatch(/not a valid/);
    expect(validateVariableMap([{ field: "subject", variable: "first_name" }], allowed)).toMatch(/built-in/);
    expect(validateVariableMap([{ field: "subject", variable: "x" }, { field: "full_email", variable: "X" }], allowed)).toMatch(/twice/);
    expect(validateVariableMap([{ field: "slot:nope", variable: "x" }], allowed)).toMatch(/Unknown/);
  });

  it("fills variables from a lead's output; skipped fields are left out", () => {
    const v = variablesFor([...map.slice(0, 4), { field: "followup:2", variable: "" }], {
      subject: "Hi",
      slots: { opener: "Saw your shop" },
      full_email: "Full",
      followUps: { 2: "F2" },
    });
    expect(v).toEqual({ fl_subject: "Hi", fl_opener: "Saw your shop", fl_ps: "", fl_full_email: "Full" });
  });
});
