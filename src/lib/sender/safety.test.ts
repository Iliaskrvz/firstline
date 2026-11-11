import { describe, expect, it } from "vitest";
import { inboxWarnings, isFreeGmail } from "./safety";

const ids = (w: { id: string }[]) => w.map((x) => x.id);

describe("Gmail safety tips", () => {
  it("knows free Gmail", () => {
    expect(isFreeGmail("a@gmail.com")).toBe(true);
    expect(isFreeGmail("A@GoogleMail.com")).toBe(true);
    expect(isFreeGmail("a@acme.nl")).toBe(false);
    expect(isFreeGmail(null)).toBe(false);
  });

  it("warns about free Gmail and its 100/day limit", () => {
    expect(ids(inboxWarnings({ email: "a@gmail.com", dailyCap: 30 }, "a@gmail.com"))).toEqual(["free_gmail"]);
    expect(ids(inboxWarnings({ email: "a@gmail.com", dailyCap: 150 }, null))).toEqual(["free_gmail", "over_gmail_limit"]);
  });

  it("warns when the inbox is on the account's own company domain", () => {
    expect(ids(inboxWarnings({ email: "sales@acme.nl", dailyCap: 30 }, "me@acme.nl"))).toEqual(["main_domain"]);
    expect(ids(inboxWarnings({ email: "sales@getacme.nl", dailyCap: 30 }, "me@acme.nl"))).toEqual([]);
    expect(ids(inboxWarnings({ email: "x@hotmail.com", dailyCap: 30 }, "y@hotmail.com"))).toEqual([]);
  });

  it("warns about a high daily limit", () => {
    expect(ids(inboxWarnings({ email: "sales@getacme.nl", dailyCap: 80 }, "me@acme.nl"))).toEqual(["high_cap"]);
    expect(ids(inboxWarnings({ email: "sales@getacme.nl", dailyCap: 50 }, "me@acme.nl"))).toEqual([]);
  });
});
