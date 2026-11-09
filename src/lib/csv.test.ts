import { describe, expect, it } from "vitest";
import {
  applyMapping,
  autoMapColumns,
  availableVariables,
  detectDelimiter,
  mappingErrors,
  parseCsv,
  toVariableKey,
  uniqueKeys,
} from "./csv";
import { creditsPerLead, estimateCredits } from "./credits";
import {
  analyseColumns,
  decodeCsvBytes,
  groupIssues,
  importBlocker,
  uploadView,
} from "./csv";
import { normaliseDomain } from "./domain";
import { readFileSync } from "node:fs";
import path from "node:path";

const fixture = (name: string) => readFileSync(path.resolve(__dirname, "../../fixtures", name));

describe("parseCsv", () => {
  it("parses comma CSV with a BOM and trims cells", () => {
    const r = parseCsv("﻿Email,First Name\n a@acme.nl , Anna \n");
    expect(r.headers).toEqual(["Email", "First Name"]);
    expect(r.rows).toEqual([{ Email: "a@acme.nl", "First Name": "Anna" }]);
    expect(r.errors).toEqual([]);
  });

  it("auto-detects semicolons (Dutch/German Excel exports)", () => {
    const r = parseCsv("e-mail;voornaam;bedrijf\nb@bakkerij.nl;Bas;Bakkerij Bas\n");
    expect(r.headers).toEqual(["e-mail", "voornaam", "bedrijf"]);
    expect(r.rows[0]).toEqual({ "e-mail": "b@bakkerij.nl", voornaam: "Bas", bedrijf: "Bakkerij Bas" });
  });

  it("handles quoted fields with commas and newlines", () => {
    const r = parseCsv('email,note\nx@y.nl,"Hello, world\nsecond line"\n');
    expect(r.rows[0].note).toBe("Hello, world\nsecond line");
  });

  it("names blank and duplicate headers", () => {
    const r = parseCsv("email,,Email\na@b.nl,x,c@d.nl\n");
    expect(r.headers).toEqual(["email", "Column 2", "Email (2)"]);
  });

  it("skips blank lines but keeps spreadsheet row numbers", () => {
    const r = parseCsv("email,company\na@b.nl\n\n,,\nc@d.nl,Acme\n");
    expect(r.rows).toEqual([
      { email: "a@b.nl", company: "" },
      { email: "c@d.nl", company: "Acme" },
    ]);
    expect(r.rowNumbers).toEqual([2, 5]);
  });

  it("reports a missing header", () => {
    expect(parseCsv("").errors).toContain("No header row found.");
  });
});

describe("detectDelimiter", () => {
  it("reads it from the header line", () => {
    expect(detectDelimiter("a;b;c\n1,5;2;3")).toBe(";");
    expect(detectDelimiter("a,b\n")).toBe(",");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter('"x;y",b,c')).toBe(",");
    expect(detectDelimiter("email")).toBe(",");
  });
});

describe("autoMapColumns", () => {
  it("maps common English, Dutch and German headers", () => {
    expect(
      autoMapColumns(["E-mail Address", "Voornaam", "Nachname", "Bedrijfsnaam", "Job Title", "Website URL", "Industry"]),
    ).toEqual({
      "E-mail Address": "email",
      Voornaam: "first_name",
      Nachname: "last_name",
      Bedrijfsnaam: "company",
      "Job Title": "title",
      "Website URL": "website",
      Industry: "custom",
    });
  });

  it("does not treat a LinkedIn URL as the website", () => {
    expect(autoMapColumns(["LinkedIn URL", "Company Website"])).toEqual({
      "LinkedIn URL": "custom",
      "Company Website": "website",
    });
  });

  it("uses each field once and prefers first name over full name", () => {
    expect(autoMapColumns(["Email", "Work email", "Name", "First name"])).toEqual({
      Email: "email",
      "Work email": "custom",
      Name: "custom",
      "First name": "first_name",
    });
  });
});

describe("mappingErrors", () => {
  it("requires an email column and no double mapping", () => {
    expect(mappingErrors({ a: "company" })).toEqual(["Pick which column holds the email address."]);
    expect(mappingErrors({ a: "email", b: "website", c: "website" })).toEqual([
      '"Website" is mapped to more than one column.',
    ]);
    expect(mappingErrors({ a: "email", b: "custom", c: "custom" })).toEqual([]);
  });
});

describe("applyMapping", () => {
  const map = {
    Email: "email",
    Name: "full_name",
    Company: "company",
    Website: "website",
    Industry: "custom",
    Notes: "ignore",
  } as const;

  it("validates, dedupes on email (case-insensitive) and normalises domains", () => {
    const r = applyMapping(
      [
        { Email: "Anna@Acme.nl", Name: "Anna de Vries", Company: "Acme", Website: "https://www.acme.nl/", Industry: "SaaS", Notes: "x" },
        { Email: "anna@acme.nl", Name: "Anna again", Company: "Acme", Website: "acme.nl", Industry: "", Notes: "" },
        { Email: "", Name: "No Mail", Company: "", Website: "", Industry: "", Notes: "" },
        { Email: "not-an-email", Name: "", Company: "", Website: "", Industry: "", Notes: "" },
        { Email: "bob@gmail.com", Name: "Bob", Company: "Bob BV", Website: "", Industry: "Retail", Notes: "" },
      ],
      map,
    );

    expect(r.leads).toEqual([
      {
        email: "anna@acme.nl",
        first_name: "Anna",
        last_name: "de Vries",
        company: "Acme",
        title: null,
        linkedin_headline: null,
        website: "https://www.acme.nl/",
        domain: "acme.nl",
        custom: { industry: "SaaS" },
      },
      {
        email: "bob@gmail.com",
        first_name: "Bob",
        last_name: null,
        company: "Bob BV",
        title: null,
        linkedin_headline: null,
        website: null,
        domain: null,
        custom: { industry: "Retail" },
      },
    ]);
    expect(r.stats).toEqual({
      total: 5,
      imported: 2,
      duplicates: 1,
      missing_email: 1,
      invalid_email: 1,
      no_website: 1,
      personal_email: 1,
    });
    // Spreadsheet row numbers: header is row 1, first data row is row 2.
    expect(r.issues.map((i) => [i.row, i.reason])).toEqual([
      [3, "duplicate"],
      [4, "missing_email"],
      [5, "invalid_email"],
      [6, "no_website"],
    ]);
  });

  it("accepts mailto: and <angle> emails", () => {
    const r = applyMapping([{ e: "mailto:X@Y.nl" }, { e: "<z@y.nl>" }], { e: "email" });
    expect(r.leads.map((l) => l.email)).toEqual(["x@y.nl", "z@y.nl"]);
  });

  it("does not let a full name overwrite separate first/last names", () => {
    const r = applyMapping([{ e: "a@b.nl", f: "Anna", n: "Someone Else" }], { e: "email", f: "first_name", n: "full_name" });
    expect(r.leads[0].first_name).toBe("Anna");
    expect(r.leads[0].last_name).toBeNull();
  });
});

describe("variable keys", () => {
  it("slugifies headers", () => {
    expect(toVariableKey("Industry Sector")).toBe("industry_sector");
    expect(toVariableKey("Ünternehmen-Größe")).toBe("unternehmen_grosse");
    expect(toVariableKey("2024 revenue")).toBe("f_2024_revenue");
    expect(toVariableKey("!!!")).toBe("field");
  });

  it("never clashes with built-in fields or each other", () => {
    expect(uniqueKeys(["Company", "City", "city"])).toEqual(["custom_company", "city", "city_2"]);
  });

  it("lists the variables a template can use", () => {
    expect(availableVariables({ E: "email", N: "full_name", W: "website", C: "custom", X: "ignore" }).sort()).toEqual(
      ["c", "domain", "email", "first_name", "last_name", "website"].sort(),
    );
  });
});

describe("credits", () => {
  it("prices add-ons per lead", () => {
    expect(creditsPerLead({ deep: false, local: false })).toBe(1);
    expect(creditsPerLead({ deep: true, local: false })).toBe(2);
    expect(creditsPerLead({ deep: true, local: true })).toBe(4);
    expect(estimateCredits(120, { deep: false, local: true })).toBe(360);
  });
});

describe("wrong file: no email or website column (caller stats export)", () => {
  const csv = parseCsv(decodeCsvBytes(fixture("no-lead-columns.csv")).text);
  const analysis = analyseColumns(csv.headers, csv.rows);

  it("is detected as not a lead list", () => {
    expect(analysis.looksLikeLeadList).toBe(false);
    expect(uploadView(analysis, false)).toBe("wrong_file");
  });

  it("suggests the column with some emails, without auto-mapping it", () => {
    expect(analysis.emailSuggestion).toEqual({ header: "Caller", valid: 1, filled: 3 });
    expect(analysis.map.Caller).toBe("custom");
  });

  it("shows the mapping screen when the user picks columns manually", () => {
    expect(uploadView(analysis, true)).toBe("mapping");
  });

  it("blocks import with a clear reason", () => {
    const r = applyMapping(csv.rows, analysis.map, csv.rowNumbers);
    expect(r.stats.imported).toBe(0);
    expect(importBlocker(analysis.map, r.stats)).toBe("Pick which column holds the email address.");
    // Accepting the suggestion: 1 lead imports, the other 2 rows are skipped.
    const map = { ...analysis.map, Caller: "email" as const };
    const r2 = applyMapping(csv.rows, map, csv.rowNumbers);
    expect(r2.stats.imported).toBe(1);
    expect(importBlocker(map, r2.stats)).toBeNull();
    expect(r2.issues.filter((i) => i.reason === "invalid_email").map((i) => i.row)).toEqual([3, 4]);
  });
});

describe("analyseColumns", () => {
  const rows = (vals: string[]) => vals.map((v) => ({ Contact: v, Bedrijf: "x" }));

  it("auto-maps a column that is at least 80% emails", () => {
    const a = analyseColumns(["Contact", "Bedrijf"], rows(["a@x.nl", "b@x.nl", "c@x.nl", "d@x.nl", "Eva"]));
    expect(a.map.Contact).toBe("email");
    expect(a.emailSuggestion).toBeNull();
    expect(a.looksLikeLeadList).toBe(true);
  });

  it("only suggests below 80%", () => {
    const a = analyseColumns(["Contact", "Bedrijf"], rows(["a@x.nl", "b@x.nl", "c@x.nl", "Dirk", "Eva"]));
    expect(a.map.Contact).toBe("full_name");
    expect(a.emailSuggestion).toEqual({ header: "Contact", valid: 3, filled: 5 });
  });

  it("ignores empty cells when measuring the share", () => {
    const a = analyseColumns(["Werk mail"], [{ "Werk mail": "a@x.nl" }, { "Werk mail": "" }, { "Werk mail": "b@x.nl" }]);
    expect(a.map["Werk mail"]).toBe("email");
  });

  it("leaves a header-mapped email column alone", () => {
    const a = analyseColumns(["Email", "Notes"], [{ Email: "a@x.nl", Notes: "cc b@x.nl" }]);
    expect(a.map).toEqual({ Email: "email", Notes: "custom" });
    expect(a.emailSuggestion).toBeNull();
  });

  it("a website column alone counts as a lead list", () => {
    expect(analyseColumns(["Website", "Naam"], [{ Website: "a.nl", Naam: "A" }]).looksLikeLeadList).toBe(true);
  });
});

describe("importBlocker", () => {
  const stats = (o: Partial<Record<string, number>>) => ({
    total: 0, imported: 0, duplicates: 0, missing_email: 0, invalid_email: 0, no_website: 0, personal_email: 0, ...o,
  });
  it("explains why nothing would import", () => {
    expect(importBlocker({ a: "email" }, stats({ total: 3, missing_email: 3 }))).toMatch(/email column is empty/);
    expect(importBlocker({ a: "email" }, stats({ total: 3, invalid_email: 2, missing_email: 1 }))).toMatch(/no row has a valid email/);
    expect(importBlocker({ a: "email" }, stats({ total: 3, imported: 1 }))).toBeNull();
  });
});

describe("groupIssues", () => {
  it("groups by type with copy that matches the type", () => {
    const groups = groupIssues([
      { row: 4, reason: "no_website" },
      { row: 2, reason: "missing_email" },
      { row: 3, reason: "missing_email" },
    ]);
    expect(groups.map((g) => [g.title, g.intro, g.rows.map((r) => r.row)])).toEqual([
      ["No email", "Skipped: we can't send without an email address.", [2, 3]],
      ["No website", "Imported, gets the neutral fallback line (free).", [4]],
    ]);
  });
});

describe("Dutch exports: semicolons, accents, encodings", () => {
  const text = "E-mail;Voornaam;Bedrijfsnaam;Website\nzoë@bakkerij-ijssel.nl;Zoë;Bakkerij IJssel & Fréderique;https://www.bakkerij-ijssel.nl/contact\n";

  it("parses UTF-8 with é, ë, ij and the ĳ ligature", () => {
    const csv = parseCsv(decodeCsvBytes(new TextEncoder().encode(text.replace("IJssel &", "ĳssel &"))).text);
    const r = applyMapping(csv.rows, analyseColumns(csv.headers, csv.rows).map, csv.rowNumbers);
    expect(r.leads[0]).toMatchObject({
      email: "zoë@bakkerij-ijssel.nl",
      first_name: "Zoë",
      company: "Bakkerij ĳssel & Fréderique",
      domain: "bakkerij-ijssel.nl",
    });
  });

  it("decodes Windows-1252 files (Excel 'CSV (semicolon delimited)')", () => {
    const bytes = Buffer.from(text, "latin1"); // é = 0xE9, ë = 0xEB: same bytes in Windows-1252
    const decoded = decodeCsvBytes(bytes);
    expect(decoded.encoding).toBe("windows-1252");
    const csv = parseCsv(decoded.text);
    expect(csv.rows[0].Voornaam).toBe("Zoë");
    expect(csv.rows[0].Bedrijfsnaam).toBe("Bakkerij IJssel & Fréderique");
  });

  it("decodes UTF-8 with a BOM and UTF-16 'Unicode text'", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Naam\nZoë\n")]);
    expect(decodeCsvBytes(bom)).toEqual({ text: "Naam\nZoë\n", encoding: "utf-8" });
    const u16 = new Uint8Array([0xff, 0xfe, ...Buffer.from("Naam\nZoë\n", "utf16le")]);
    expect(decodeCsvBytes(u16)).toEqual({ text: "Naam\nZoë\n", encoding: "utf-16le" });
  });

  it("cleans website URLs to bare domains", () => {
    expect(normaliseDomain("https://www.site.nl/contact")).toBe("site.nl");
  });

  it("the sample fixture imports as expected", () => {
    const csv = parseCsv(decodeCsvBytes(fixture("sample-leads.csv")).text);
    const r = applyMapping(csv.rows, analyseColumns(csv.headers, csv.rows).map, csv.rowNumbers);
    expect(r.stats).toMatchObject({ total: 7, imported: 4, duplicates: 1, invalid_email: 1, missing_email: 1, no_website: 1 });
  });
});
