import { describe, expect, it } from "vitest";
import { isAllowed, parseRobots } from "./robots";

describe("robots.txt", () => {
  const r = parseRobots(`
# comment
User-agent: *
Disallow: /private/
Disallow: /*.pdf$
Allow: /private/public-page

User-agent: FirecrawlAgent
User-agent: OtherBot
Disallow: /blog/
`);

  it("uses the most specific group for our agent", () => {
    expect(isAllowed(r, "FirecrawlAgent", "/blog/post")).toBe(false);
    expect(isAllowed(r, "FirecrawlAgent", "/private/x")).toBe(true); // its own group doesn't block /private
    expect(isAllowed(r, "SomeBot", "/blog/post")).toBe(true);
  });

  it("applies longest match and wildcards", () => {
    expect(isAllowed(r, "SomeBot", "/private/x")).toBe(false);
    expect(isAllowed(r, "SomeBot", "/private/public-page")).toBe(true);
    expect(isAllowed(r, "SomeBot", "/files/menu.pdf")).toBe(false);
    expect(isAllowed(r, "SomeBot", "/files/menu.pdf?x")).toBe(true);
  });

  it("empty Disallow allows everything; Disallow: / blocks everything", () => {
    expect(isAllowed(parseRobots("User-agent: *\nDisallow:"), "x", "/a")).toBe(true);
    expect(isAllowed(parseRobots("User-agent: *\nDisallow: /"), "x", "/")).toBe(false);
    expect(isAllowed(parseRobots(""), "x", "/")).toBe(true);
  });
});
