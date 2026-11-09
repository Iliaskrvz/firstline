import { describe, expect, it } from "vitest";
import { classifyUrl, pickPages, urlDate, urlLang } from "./urls";

const D = "bakkerij.nl";
describe("classifyUrl", () => {
  it.each([
    ["https://www.bakkerij.nl/", "home"],
    ["https://bakkerij.nl/nl", "home"],
    ["https://bakkerij.nl/over-ons", "about"],
    ["https://bakkerij.nl/nl/wie-zijn-wij/", "about"],
    ["https://bakkerij.nl/ons-team", "about"],
    ["https://bakkerij.nl/over-bakkerij-bos", "about"],
    ["https://bakkerij.nl/about-us", "about"],
    ["https://bakkerij.nl/de/ueber-uns", "about"],
    ["https://bakkerij.nl/diensten/catering", "services"],
    ["https://bakkerij.nl/onze-werkwijze", "services"],
    ["https://bakkerij.nl/leistungen", "services"],
    ["https://bakkerij.nl/nieuws", "news"],
    ["https://bakkerij.nl/blog/2025/10/nieuwe-oven", "news"],
    ["https://bakkerij.nl/aktuelles/x", "news"],
    ["https://bakkerij.nl/vacatures/bakker", "careers"],
    ["https://bakkerij.nl/werken-bij", "careers"],
  ])("%s -> %s", (url, type) => {
    expect(classifyUrl(url, D)?.type).toBe(type);
  });

  it.each([
    "https://bakkerij.nl/privacy",
    "https://bakkerij.nl/cookies",
    "https://bakkerij.nl/blog/tag/brood",
    "https://bakkerij.nl/blog/category/nieuws",
    "https://bakkerij.nl/wp-admin/",
    "https://bakkerij.nl/feed",
    "https://bakkerij.nl/files/menu.pdf",
    "https://bakkerij.nl/winkelwagen",
    "https://bakkerij.nl/contact",
    "https://other.nl/over-ons",
    "https://shop.bakkerij.nl/over-ons",
    "mailto:info@bakkerij.nl",
  ])("drops %s", (url) => {
    expect(classifyUrl(url, D)).toBeNull();
  });

  it("drops legal pages, also inside longer slugs, but keeps real content", () => {
    expect(classifyUrl("https://www.adyen.com/legal/sales-day-payout-terms-of-service", "adyen.com")).toBeNull();
    expect(classifyUrl("https://x.nl/services/terms-and-conditions", "x.nl")).toBeNull();
    expect(classifyUrl("https://x.nl/diensten/algemene-voorwaarden-2024", "x.nl")).toBeNull();
    expect(classifyUrl("https://x.nl/over-ons/privacyverklaring", "x.nl")).toBeNull();
    expect(classifyUrl("https://x.nl/producten/chocolate-cookie-box", "x.nl")?.type).toBe("services");
  });

  it("strips query and fragment", () => {
    expect(classifyUrl("https://bakkerij.nl/over-ons/?utm=x#team", D)?.url).toBe("https://bakkerij.nl/over-ons");
  });
});

describe("urlDate", () => {
  it("finds dates in paths", () => {
    expect(urlDate("/blog/2025/10/x")).toBe(20251001);
    expect(urlDate("/nieuws/2024-03-15-opening")).toBe(20240315);
    expect(urlDate("/news/jaaroverzicht-2023")).toBeNull(); // a year in a slug is a topic, not a date
    expect(urlDate("/blog/salderen-hoe-verder-na-2023")).toBeNull();
    expect(urlDate("/blog/zuurdesem")).toBeNull();
  });
});

describe("pickPages", () => {
  const site = [
    "https://bakkerij.nl/",
    "https://bakkerij.nl/over-ons/geschiedenis",
    "https://bakkerij.nl/over-ons",
    "https://bakkerij.nl/diensten",
    "https://bakkerij.nl/diensten/catering",
    "https://bakkerij.nl/nieuws",
    "https://bakkerij.nl/nieuws/2024/05/oude-post",
    "https://bakkerij.nl/nieuws/2025/09/nieuwe-winkel",
    "https://bakkerij.nl/vacatures",
    "https://bakkerij.nl/privacy",
  ];

  it("homepage + best about + best services + newest dated post", () => {
    expect(pickPages(site, D)).toEqual([
      { url: "https://bakkerij.nl/", type: "home" },
      { url: "https://bakkerij.nl/over-ons", type: "about" },
      { url: "https://bakkerij.nl/diensten", type: "services" },
      { url: "https://bakkerij.nl/nieuws/2025/09/nieuwe-winkel", type: "news" },
    ]);
  });

  it("falls back to the news index when posts have no dates", () => {
    const p = pickPages(["https://bakkerij.nl/blog", "https://bakkerij.nl/blog/zuurdesem"], D);
    expect(p).toEqual([
      { url: "https://bakkerij.nl/", type: "home" },
      { url: "https://bakkerij.nl/blog", type: "news" },
    ]);
  });

  it("adds careers only when there's room, and respects the Lite limit", () => {
    expect(pickPages(["https://bakkerij.nl/over-ons", "https://bakkerij.nl/vacatures"], D).map((p) => p.type)).toEqual(["home", "about", "careers"]);
    expect(pickPages(site, D, 2).map((p) => p.type)).toEqual(["home", "about"]);
  });

  it("still returns the homepage when the map is empty", () => {
    expect(pickPages([], D)).toEqual([{ url: "https://bakkerij.nl/", type: "home" }]);
  });
});

describe("language preference (multi-language sites)", () => {
  const picnic = [
    "https://picnic.app/de",
    "https://picnic.app/fr/a-propos/cycliste-picnic",
    "https://picnic.app/nl",
    "https://picnic.app/nl/over-picnic",
    "https://picnic.app/nl/over-picnic/duurzame-producten",
    "https://picnic.app/de/ueber-uns",
  ];

  it("stays in the language from the lead's URL", () => {
    expect(urlLang("https://www.picnic.app/nl")).toBe("nl");
    expect(urlLang("picnic.app/nl/over")).toBe("nl");
    expect(urlLang("https://picnic.app/")).toBeNull();
    expect(pickPages(picnic, "picnic.app", 4, "nl")).toEqual([
      { url: "https://picnic.app/nl", type: "home" },
      { url: "https://picnic.app/nl/over-picnic", type: "about" },
    ]);
  });

  it("without a preference, prefers unprefixed pages, else the most common language", () => {
    expect(pickPages(["https://a.nl/over-ons", "https://a.nl/en/about"], "a.nl").map((p) => p.url)).toEqual(["https://a.nl/", "https://a.nl/over-ons"]);
    expect(pickPages(picnic, "picnic.app", 4).map((p) => p.url)).toEqual(["https://picnic.app/nl", "https://picnic.app/nl/over-picnic"]);
  });
});
