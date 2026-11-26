// Refresh the vendored throwaway-domain list from disposable-email-domains (CC0-1.0: public domain,
// commercial use allowed, no attribution required). Run now and then, review the diff, commit:
//   npx tsx scripts/update-disposable-domains.ts
import { writeFileSync } from "node:fs";

const SOURCE = "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf";
const OUT = "src/lib/data/disposable-domains.txt";
const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

async function main() {
  const res = await fetch(SOURCE, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const lines = (await res.text()).split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean);
  const domains = [...new Set(lines.filter((l) => DOMAIN.test(l)))].sort();
  const rejected = lines.length - domains.length;
  if (domains.length < 1000) throw new Error(`Only ${domains.length} domains: refusing to replace the list (format changed?).`);
  const header = [
    "# Throwaway (disposable) email domains, one per line.",
    `# Source: ${SOURCE}`,
    "# Licence: CC0-1.0 (public domain) — https://creativecommons.org/publicdomain/zero/1.0/",
    `# Updated: ${new Date().toISOString().slice(0, 10)} by scripts/update-disposable-domains.ts`,
  ];
  writeFileSync(OUT, `${header.join("\n")}\n${domains.join("\n")}\n`);
  console.log(`Wrote ${domains.length} domains to ${OUT}${rejected ? ` (${rejected} lines skipped: not a plain domain)` : ""}.`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
