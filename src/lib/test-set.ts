// Quality Lab test sets from a CSV (no email addresses needed). Pure.
import { analyseColumns, parseCsv } from "./csv";
import { normaliseDomain } from "./domain";
import type { TestLead } from "@/engine/lab";

export function testLeadsFromCsv(text: string, max = 100): { leads: TestLead[]; skipped: number } {
  const csv = parseCsv(text);
  const { map } = analyseColumns(csv.headers, csv.rows);
  const col = (target: string) => csv.headers.find((h) => map[h] === target);
  const [first, company, title, website] = ["first_name", "company", "title", "website"].map(col);
  const leads: TestLead[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const row of csv.rows) {
    const domain = normaliseDomain(website ? row[website] : null);
    if (!domain || seen.has(domain)) {
      skipped++;
      continue;
    }
    seen.add(domain);
    leads.push({
      first_name: (first && row[first]?.trim()) || null,
      company: (company && row[company]?.trim()) || null,
      title: (title && row[title]?.trim()) || null,
      domain,
      website: website ? row[website]?.trim() || null : null,
    });
    if (leads.length >= max) break;
  }
  return { leads, skipped };
}
