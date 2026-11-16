// sitemap.xml: the public marketing pages, with their other-language version where there is one.
import type { MetadataRoute } from "next";
import { COMPETITORS } from "@/content/competitors";
import { LANGUAGE_PAIRS } from "@/content/meta";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.PUBLIC_APP_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
  const url = (p: string) => `${base}${p === "/" ? "" : p}`;
  const pairs = Object.values(LANGUAGE_PAIRS).flatMap((pair) =>
    [pair.en, pair.nl].map((p) => ({ url: url(p), alternates: { languages: { en: url(pair.en), nl: url(pair.nl) } } })),
  );
  const single = ["/compare", ...COMPETITORS.map((c) => `/compare/${c.id}`), "/calculator", "/agencies", "/trust", "/docs/api", "/privacy", "/terms", "/dpa", "/subprocessors"].map((p) => ({ url: url(p) }));
  return [...pairs, ...single];
}
