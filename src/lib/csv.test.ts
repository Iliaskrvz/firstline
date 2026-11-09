import { describe, expect, it } from "vitest";
import {
  applyMapping,
  autoMapColumns,
  availableVariables,
  mappingErrors,
  parseCsv,
  toVariableKey,
  uniqueKeys,
} from "./csv";
import { creditsPerLead, estimateCredits } from "./credits";

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

  it("skips blank lines and fills short rows", () => {
    const r = parseCsv("email,company\na@b.nl\n\n,,\nc@d.nl,Acme\n");
    expect(r.rows).toEqual([
      { email: "a@b.nl", company: "" },
      { email: "c@d.nl", company: "Acme" },
    ]);
  });

  it("reports a missing header", () => {
    expect(parseCsv("").errors).toContain("No header row found.");
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
    expect(r.issues.map((i) => [i.row, i.reason])).toEqual([
      [2, "duplicate"],
      [3, "missing_email"],
      [4, "invalid_email"],
      [5, "no_website"],
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
