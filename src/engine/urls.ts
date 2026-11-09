// Page picker (§5): classify a site's URLs by path keywords (no AI) and pick
// homepage + best about/team + best services + newest news/blog post.
import type { PageType, PickedPage } from "./types";

const KEYWORDS: Record<Exclude<PageType, "home">, string[]> = {
  about: ["over", "over-ons", "overons", "wie-zijn-wij", "wie-we-zijn", "ons-verhaal", "team", "about", "about-us", "story", "our-story", "ueber-uns", "uber-uns", "über-uns", "wer-wir-sind", "qui-sommes-nous", "a-propos"],
  services: ["diensten", "dienst", "behandelingen", "werkwijze", "services", "service", "solutions", "oplossingen", "what-we-do", "wat-we-doen", "leistungen", "aanbod", "expertise", "producten", "products"],
  news: ["nieuws", "blog", "blogs", "actueel", "news", "updates", "aktuelles", "neuigkeiten", "artikelen", "articles", "insights"],
  careers: ["vacatures", "vacature", "werken-bij", "werkenbij", "careers", "career", "jobs", "karriere", "karriere"],
};

const DROP_SEGMENTS = new Set([
  "privacy", "privacy-policy", "privacybeleid", "privacyverklaring", "datenschutz", "cookie", "cookies", "cookiebeleid",
  "login", "inloggen", "signin", "sign-in", "register", "account", "mijn-account", "cart", "winkelwagen", "checkout",
  "tag", "tags", "category", "categorie", "categories", "author", "wp-admin", "wp-login.php", "wp-json", "wp-content",
  "feed", "rss", "search", "zoeken", "terms", "voorwaarden", "algemene-voorwaarden", "disclaimer", "sitemap", "impressum", "page",
  "legal", "juridisch", "policies", "policy", "gdpr", "compliance", "rechtliches", "agb",
]);
/** Legal pages hide inside longer slugs too ("sales-day-payout-terms-of-service"). */
const DROP_PARTS = ["terms-of", "terms-and", "privacy", "cookie-policy", "cookie-statement", "voorwaarden", "disclaimer", "datenschutz"];
const DROP_EXT = /\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|mp4|mp3|xml|json|css|js|ico|txt)$/i;
const LANG_ROOT = /^(nl|en|de|fr|nl-nl|en-gb|en-us|de-de|be|fr-be|nl-be)$/;

export type Classified = { url: string; type: PageType; depth: number; date: number | null; lang: string | null } | null;

function sameSite(host: string, domain: string) {
  const h = host.toLowerCase().replace(/^www\d*\./, "");
  return h === domain;
}

function segMatches(seg: string, kw: string) {
  if (seg === kw) return true;
  if (kw.includes("-")) return seg.includes(kw);
  return seg.split(/[-_.]/).includes(kw);
}

/** A date hidden in the URL (/2025/10/, 2025-10-03, ...) as yyyymmdd, for "newest post". */
/** Only year+month counts: a lone year in a slug is often a topic ("plans-for-2030"), not a date. */
export function urlDate(path: string): number | null {
  const full = path.match(/(20\d{2})[/-](0[1-9]|1[0-2])(?:[/-](0[1-9]|[12]\d|3[01]))?(?:[/-]|$)/);
  return full ? Number(full[1]) * 10_000 + Number(full[2]) * 100 + Number(full[3] ?? 1) : null;
}

/** Language prefix of a URL path ("/nl/over-ons" -> "nl"), or null. */
export function urlLang(urlOrPath: string): string | null {
  let path = urlOrPath;
  try {
    path = new URL(urlOrPath.includes("://") ? urlOrPath : `https://x/${urlOrPath.replace(/^[^/]*\//, "")}`).pathname;
  } catch {
    /* keep as is */
  }
  const first = path.toLowerCase().split("/").filter(Boolean)[0] ?? "";
  return LANG_ROOT.test(first) ? first.slice(0, 2) : null;
}

export function normaliseUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.search = "";
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

export function classifyUrl(raw: string, domain: string): Classified {
  const norm = normaliseUrl(raw);
  if (!norm) return null;
  const u = new URL(norm);
  if (!sameSite(u.hostname, domain)) return null;
  const path = decodeURIComponent(u.pathname).toLowerCase();
  if (DROP_EXT.test(path)) return null;
  const segs = path.split("/").filter(Boolean);
  const lang = segs.length && LANG_ROOT.test(segs[0]) ? segs[0].slice(0, 2) : null;
  const content = lang ? segs.slice(1) : segs;
  if (content.length === 0) return { url: norm, type: "home", depth: 0, date: null, lang };
  if (content.some((s) => DROP_SEGMENTS.has(s) || DROP_PARTS.some((p) => s.includes(p)))) return null;

  for (const type of ["careers", "news", "about", "services"] as const) {
    const at = content.findIndex((s) => KEYWORDS[type].some((k) => segMatches(s, k)));
    if (at !== -1) return { url: norm, type, depth: content.length, date: type === "news" ? urlDate(path) : null, lang };
  }
  return null;
}

/**
 * Picks pages to scrape. Always starts with the homepage. Prefers the site
 * language from the lead's URL (or the unprefixed site). News: a dated post
 * (newest first), else the news index (it lists the latest posts), else any post.
 */
export function pickPages(urls: string[], domain: string, limit = 4, preferLang: string | null = null): PickedPage[] {
  const seen = new Set<string>();
  const all = urls
    .map((u) => classifyUrl(u, domain))
    .filter((c): c is NonNullable<Classified> => !!c && !seen.has(c.url) && !!seen.add(c.url));

  // Stay in one language: the preferred one if the site has it, else unprefixed pages, else the most common.
  const langs = new Map<string | null, number>();
  for (const i of all) langs.set(i.lang, (langs.get(i.lang) ?? 0) + 1);
  const tieOrder = ["nl", "en", "de", "fr"];
  const rank = (l: string | null) => (l && tieOrder.includes(l) ? tieOrder.indexOf(l) : tieOrder.length);
  const chosen =
    preferLang && langs.has(preferLang)
      ? preferLang
      : langs.has(null)
        ? null
        : ([...langs.entries()].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]))[0]?.[0] ?? null);
  const items = all.filter((i) => i.lang === chosen);

  const best = (type: PageType) =>
    items
      .filter((i) => i.type === type)
      .sort((a, b) => a.depth - b.depth || a.url.length - b.url.length)[0];

  const news = items.filter((i) => i.type === "news");
  const datedPost = news.filter((n) => n.date && n.depth >= 2).sort((a, b) => b.date! - a.date!)[0];
  const newsIndex = news.filter((n) => n.depth === 1).sort((a, b) => a.url.length - b.url.length)[0];
  const anyPost = news.filter((n) => n.depth >= 2)[0];

  const home = items.find((i) => i.type === "home")?.url ?? (chosen ? `https://${domain}/${chosen}` : `https://${domain}/`);
  const picked: PickedPage[] = [{ url: home, type: "home" }];
  const add = (c: NonNullable<Classified> | undefined) => {
    if (c && picked.length < limit && !picked.some((p) => p.url === c.url)) picked.push({ url: c.url, type: c.type });
  };
  add(best("about"));
  add(best("services"));
  add(datedPost ?? newsIndex ?? anyPost);
  add(best("careers")); // bonus hiring signal, only if there's room
  return picked;
}
