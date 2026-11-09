// Page text cleaning (§4): drop navigation, footers, cookie banners, scripts and
// invisible characters, then wrap pages as clearly-marked DATA for the model.
import { createHash } from "node:crypto";

const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿­]/g;
const INJECTION = [
  /ignore (all |any )?(the )?(previous|prior|above) (instructions|prompts?)/i,
  /disregard (all |any )?(the )?(previous|prior|above)/i,
  /\byou are (now )?(chatgpt|claude|an? (ai|assistant|language model))\b/i,
  /\b(system|developer) prompt\b/i,
  /^\s*(system|assistant|user)\s*:/i,
  /\bnew instructions?\s*:/i,
];
const BOILERPLATE = [
  /cookie/i, /\bconsent\b/i, /©|\(c\)\s*\d{4}|all rights reserved|alle rechten voorbehouden|alle rechte vorbehalten/i,
  /^\s*(skip to (main )?content|naar (de )?inhoud|ga naar|menu|zoeken|search|login|inloggen)\s*$/i,
  /privacy (policy|statement|verklaring)|privacybeleid|algemene voorwaarden|terms (and|&) conditions/i,
  /you are (currently )?(on|viewing) the|u bevindt zich|je bevindt je|je bent nu op|sie befinden sich/i,
];

export function hashText(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** Lines that are mostly links (menus, footers, breadcrumbs). */
function isLinkHeavy(line: string): boolean {
  const links = line.match(/\[[^\]]*\]\([^)]*\)/g) ?? [];
  if (links.length === 0) return false;
  const linkText = links.join("").length;
  const bare = line.replace(/^[\s*\-+>|#\d.]+/, "");
  if (links.length >= 2 && linkText / Math.max(1, bare.length) > 0.6) return true;
  // A bullet that is just one short link: a menu item.
  const onlyLink = bare.trim().match(/^\[([^\]]*)\]\([^)]*\)$/);
  return !!onlyLink && onlyLink[1].trim().split(/\s+/).length <= 4;
}

export function cleanMarkdown(md: string, maxChars = 6000): string {
  let s = md.replace(INVISIBLE, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style|noscript|iframe|svg)[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<[^>]+>/g, " "); // stray HTML
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // images
  s = s.replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "");

  const out: string[] = [];
  const seen = new Set<string>();
  for (let line of s.split(/\r?\n/)) {
    if (isLinkHeavy(line)) continue;
    line = line.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // keep link text only
    line = line.replace(/https?:\/\/\S+/g, "").replace(/[ \t]+/g, " ").trim();
    if (!line) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (line.length < 140 && BOILERPLATE.some((r) => r.test(line))) continue;
    if (INJECTION.some((r) => r.test(line))) {
      out.push("[removed: text addressed to an AI]");
      continue;
    }
    const key = line.toLowerCase();
    if (seen.has(key) && line.length < 200) continue; // repeated menus/CTAs
    seen.add(key);
    out.push(line);
  }

  let text = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length > maxChars) {
    const cut = text.lastIndexOf("\n\n", maxChars);
    text = text.slice(0, cut > maxChars * 0.6 ? cut : maxChars).trim();
  }
  return text;
}

/** Wrap pages as data. Our own tag names are neutralised inside page text. */
export function wrapPagesAsData(pages: { id: string; url: string; type: string; markdown: string }[]): string {
  const esc = (t: string) => t.replace(/<\/?\s*(page|pages|website_data)\b/gi, (m) => m.replace("<", "‹"));
  return [
    "<website_data>",
    ...pages.map((p) => `<page id="${p.id}" url="${p.url}" type="${p.type}">\n${esc(p.markdown)}\n</page>`),
    "</website_data>",
  ].join("\n");
}
