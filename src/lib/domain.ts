// Domain normalising: turns whatever is in a "website" column into a bare,
// lowercase registrable host ("acme.nl"), or null if it isn't a usable domain.

const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/** Free / personal mailbox providers: their domain says nothing about the company. */
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.nl",
  "outlook.com",
  "outlook.nl",
  "live.com",
  "live.nl",
  "msn.com",
  "yahoo.com",
  "yahoo.nl",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "ziggo.nl",
  "kpnmail.nl",
  "planet.nl",
  "home.nl",
  "telenet.be",
  "skynet.be",
]);

export function normaliseDomain(input: string | null | undefined): string | null {
  if (input == null) return null;
  let s = String(input).trim().toLowerCase();
  if (!s) return null;

  // An email address in the website column: take the part after @.
  if (/^[^\s@/]+@[^\s@/]+$/.test(s)) s = s.split("@")[1];

  // Strip protocol-ish prefixes and anything after the host.
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^\/\//, "");
  s = s.split(/[/?#\s]/)[0];
  s = s.replace(/^[^@]*@/, ""); // userinfo
  s = s.replace(/:\d+$/, ""); // port
  s = s.replace(/\.+$/, ""); // trailing dot

  // IDN -> punycode via the URL parser.
  try {
    s = new URL(`http://${s}`).hostname;
  } catch {
    return null;
  }

  s = s.replace(/^www\d*\./, "");

  const labels = s.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((l) => HOST_LABEL.test(l))) return null;
  if (!TLD.test(labels[labels.length - 1])) return null;
  // Raw IP addresses are not company domains.
  if (/^\d+(\.\d+){3}$/.test(s)) return null;

  return s;
}

export function isFreeMailDomain(domain: string | null | undefined): boolean {
  return !!domain && FREE_MAIL_DOMAINS.has(domain);
}
