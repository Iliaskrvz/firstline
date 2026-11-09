import { describe, expect, it } from "vitest";
import { isFreeMailDomain, normaliseDomain } from "./domain";

describe("normaliseDomain", () => {
  it.each([
    ["acme.nl", "acme.nl"],
    ["ACME.NL", "acme.nl"],
    ["  acme.nl  ", "acme.nl"],
    ["https://www.acme.nl/", "acme.nl"],
    ["http://acme.nl/over-ons?x=1#team", "acme.nl"],
    ["www.acme.co.uk", "acme.co.uk"],
    ["www2.acme.com", "acme.com"],
    ["//acme.de/impressum", "acme.de"],
    ["acme.nl:8080/path", "acme.nl"],
    ["shop.acme.nl", "shop.acme.nl"],
    ["acme.nl.", "acme.nl"],
    ["info@acme.nl", "acme.nl"],
    ["bäckerei-müller.de", "xn--bckerei-mller-bfb28a.de"],
    ["https://user:pw@acme.nl", "acme.nl"],
  ])("%s -> %s", (input, expected) => {
    expect(normaliseDomain(input)).toBe(expected);
  });

  it.each([null, undefined, "", "   ", "n/a", "localhost", "acme", "http://", "192.168.1.1", "-acme.nl", "acme..nl", "acme.n1"])(
    "rejects %s",
    (input) => {
      expect(normaliseDomain(input as string)).toBeNull();
    },
  );
});

describe("isFreeMailDomain", () => {
  it("flags personal mailbox providers", () => {
    expect(isFreeMailDomain("gmail.com")).toBe(true);
    expect(isFreeMailDomain("hotmail.nl")).toBe(true);
    expect(isFreeMailDomain("acme.nl")).toBe(false);
    expect(isFreeMailDomain(null)).toBe(false);
  });
});
