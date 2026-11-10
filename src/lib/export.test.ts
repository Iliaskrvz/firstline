import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { buildExport, exportFileName, safeCell, type ExportLead } from "./export";

const lead = (over: Partial<ExportLead> = {}): ExportLead => ({
  id: "l1", email: "anna@acme.nl", first_name: "Anna", last_name: "de Vries", company: "Acme", title: "Founder", linkedin_headline: null,
  website: "acme.nl", domain: "acme.nl", custom: { branche: "Design" }, status: "done", status_detail: null, confidence: "high", ...over,
});

describe("CSV export", () => {
  it("has the lead columns, custom columns and the fl_ columns", () => {
    const { headers, rows } = buildExport(
      [lead(), lead({ id: "l2", email: "bob@b.nl", status: "fallback", confidence: "low", custom: {} }), lead({ id: "l3", email: "c@c.nl", status: "failed" })],
      [
        { lead_id: "l1", step_no: 2, subject: "", full_email: "Hi Anna, follow-up", slot_outputs: {}, facts_used: [], research: {} },
        {
          lead_id: "l1", step_no: 1, subject: "Idea for Acme", full_email: "Hi Anna,\n\nSaw your Rotterdam studio.", slot_outputs: { opener: "Saw your Rotterdam studio." },
          facts_used: ["F1", "F2"], research: { facts: [{ id: "F1", src: "https://acme.nl/nieuws" }, { id: "F2", src: "https://acme.nl/nieuws" }, { id: "F3", src: "https://acme.nl/x" }] },
        },
        { lead_id: "l2", step_no: 1, subject: "Idea for B", full_email: "Hi Bob,\n\nI'll keep this short.", slot_outputs: { opener: "I'll keep this short." }, facts_used: [], research: {} },
        { lead_id: "l3", step_no: 1, subject: "", full_email: "", slot_outputs: {}, facts_used: [], research: {} },
      ],
      { slotKeys: ["opener"], followUpSteps: [2] },
    );
    expect(headers).toEqual([
      "email", "first_name", "last_name", "company", "title", "linkedin_headline", "website", "domain", "branche",
      "fl_status", "fl_subject", "fl_opener", "fl_full_email", "fl_followup_2", "fl_sources", "fl_confidence",
    ]);
    const row = Object.fromEntries(headers.map((h, i) => [h, rows[0][i]]));
    expect(row).toMatchObject({ fl_status: "personalised", fl_opener: "Saw your Rotterdam studio.", fl_followup_2: "Hi Anna, follow-up", fl_sources: "https://acme.nl/nieuws", fl_confidence: "high", branche: "Design" });
    expect(rows[1][headers.indexOf("fl_status")]).toBe("fallback");
    expect(rows[2][headers.indexOf("fl_full_email")]).toBe(""); // failed: nothing to send
  });

  it("round-trips through a CSV parser, including line breaks and quotes", () => {
    const { headers, rows } = buildExport([lead({ company: 'Acme "Studio", BV' })], [], { slotKeys: [], followUpSteps: [] });
    const csv = Papa.unparse({ fields: headers, data: rows });
    const back = Papa.parse<string[]>(csv).data;
    expect(back[1][headers.indexOf("company")]).toBe('Acme "Studio", BV');
  });

  it("neutralises spreadsheet formulas", () => {
    expect(safeCell("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(safeCell("+31 6 123")).toBe("'+31 6 123");
    expect(safeCell("Hello")).toBe("Hello");
  });

  it("file name", () => {
    expect(exportFileName("Q4 · Bakkerijen (NL)!")).toBe("firstline-q4-bakkerijen-nl.csv");
  });
});
