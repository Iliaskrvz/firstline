import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { testLeadsFromCsv } from "./test-set";

describe("test set CSV", () => {
  it("reads the starter set: 17 companies with clean domains, no emails needed", () => {
    const { leads, skipped } = testLeadsFromCsv(readFileSync(path.join(__dirname, "../../fixtures/lab-test-set.csv"), "utf8"));
    expect(skipped).toBe(0);
    expect(leads).toHaveLength(17);
    expect(leads[4]).toMatchObject({ company: "Picnic", domain: "picnic.app", website: "picnic.app/nl", first_name: "Emma" });
  });
  it("skips rows without a usable website and duplicates; caps the size", () => {
    const csv = "company,website\nA,a.nl\nB,\nC,a.nl\nD,d.nl\nE,e.nl";
    expect(testLeadsFromCsv(csv)).toMatchObject({ skipped: 2 });
    expect(testLeadsFromCsv(csv, 2).leads.map((l) => l.domain)).toEqual(["a.nl", "d.nl"]);
  });
});
