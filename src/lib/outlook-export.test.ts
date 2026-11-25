// "Download for Outlook": every .eml is read back with a real MIME parser (postal-mime), as a mail
// program would, and the ZIP is unpacked and checked file by file.
import { strFromU8, unzipSync } from "fflate";
import Papa from "papaparse";
import PostalMime from "postal-mime";
import { describe, expect, it } from "vitest";
import { buildEml, buildOutlookZip, emlFileName, encodeHeader, mailMergeCsv, outlookZipName, safePart, textToHtml, type OutlookLead } from "./outlook-export";

const draft = (over: Partial<OutlookLead["first"]> = {}): OutlookLead["first"] => ({
  to: "sanne@bakkerijvos.nl",
  firstName: "Sanne",
  lastName: "de Vos",
  company: "Bakkerij Vos",
  subject: "Quick question about Utrecht-Oost",
  text: "Hi Sanne,\n\nSaw that Bakkerij Vos just opened a second shop in Utrecht-Oost, congrats.\n\nWorth a quick call? https://example.com/plan\n\nTom\n\nNot interested? Reply \"stop\" and I won't email again.",
  ...over,
});

describe("one .eml draft", () => {
  it("opens as an unsent draft: To, Subject, X-Unsent, no From, text and HTML", async () => {
    const eml = buildEml(draft(), "b1");
    expect(eml).toContain("X-Unsent: 1\r\n");
    expect(eml).not.toMatch(/^From:/m);
    expect(eml.split("\r\n").every((l) => l.length <= 998)).toBe(true);
    expect(eml.replace(/\r\n/g, "")).not.toMatch(/\n/); // CRLF everywhere
    const m = await PostalMime.parse(eml);
    expect(m.from).toBeUndefined();
    expect(m.to).toEqual([{ address: "sanne@bakkerijvos.nl", name: "Sanne de Vos" }]);
    expect(m.subject).toBe("Quick question about Utrecht-Oost");
    expect(m.headers.find((h) => h.key === "x-unsent")?.value).toBe("1");
    expect(m.text?.replace(/\r\n/g, "\n")).toBe(draft().text);
    expect(m.html).toContain('<a href="https://example.com/plan">https://example.com/plan</a>');
    expect(m.html).toContain("Bakkerij Vos just opened");
  });

  it("keeps accents and other scripts intact in subject, name and body", async () => {
    const d = draft({ firstName: "Zoë", lastName: "Müller-Ødegård", subject: "Vraagje over jullie nieuwe vestiging in Den Haag – één idee", text: "Hoi Zoë,\n\nGefeliciteerd met de opening, café-eigenaar 🎉.\n\nGroet" });
    const m = await PostalMime.parse(buildEml(d, "b2"));
    expect(m.subject).toBe(d.subject);
    expect(m.to?.[0]).toEqual({ address: "sanne@bakkerijvos.nl", name: "Zoë Müller-Ødegård" });
    expect(m.text?.replace(/\r\n/g, "\n")).toBe(d.text);
  });

  it("header injection is impossible: line breaks in names or subjects stay on one line", async () => {
    const m = await PostalMime.parse(buildEml(draft({ subject: "Hi\r\nBcc: evil@x.com", firstName: "A\nBcc: evil@x.com" }), "b3"));
    expect(m.bcc).toBeUndefined();
    expect(m.subject).toBe("Hi Bcc: evil@x.com");
  });

  it("long non-ASCII subjects are split into valid encoded words", () => {
    const enc = encodeHeader("é".repeat(200));
    expect(enc.split("\r\n ").every((w) => w.length <= 76)).toBe(true);
    expect(encodeHeader("Plain subject")).toBe("Plain subject");
  });

  it("HTML is escaped", () => {
    expect(textToHtml("<script>alert(1)</script> & co")).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; co");
  });
});

describe("file names", () => {
  it("company + first name, safe characters only, unique", () => {
    const used = new Set<string>();
    expect(emlFileName(draft(), used)).toBe("bakkerij-vos_sanne.eml");
    expect(emlFileName(draft(), used)).toBe("bakkerij-vos_sanne_2.eml");
    expect(emlFileName(draft({ company: "Café Ø / B.V.", firstName: "Zoë" }), used)).toBe("cafe-o-b-v_zoe.eml");
    expect(emlFileName(draft({ company: null, firstName: null, to: "info@x.nl" }), used)).toBe("info.eml");
    expect(emlFileName(draft({ company: "../../etc", firstName: "passwd" }), used)).toBe("etc_passwd.eml");
    expect(safePart("ÆØÅ ñ 日本 Straße")).toBe("aeoa-n-strasse"); // non-Latin letters dropped, never path characters
    expect(outlookZipName("Bakeries Utrecht")).toBe("bakeries-utrecht-outlook-drafts.zip");
  });
});

describe("the ZIP", () => {
  const leads: OutlookLead[] = [
    { first: draft(), followUps: [{ step: 2, draft: draft({ text: "Hi Sanne,\n\nJust bumping this up.\n\nTom" }) }] },
    { first: draft({ to: "joris@zuurdesemhuis.nl", firstName: "Joris", lastName: "Bakker", company: "Het Zuurdesemhuis" }), followUps: [] },
  ];

  it("has a folder per step, a bilingual README, and every .eml parses", async () => {
    const files = unzipSync(buildOutlookZip({ campaign: "Bakeries Utrecht", leads, mailMerge: false, boundary: (i) => `b${i}` }));
    expect(Object.keys(files).sort()).toEqual([
      "README.txt",
      "step-1-first-email/bakkerij-vos_sanne.eml",
      "step-1-first-email/het-zuurdesemhuis_joris.eml",
      "step-2-follow-up/bakkerij-vos_sanne.eml",
    ]);
    const readme = strFromU8(files["README.txt"]);
    expect(readme).toMatch(/NEW emails, not replies in the same thread/);
    expect(readme).toMatch(/NIEUWE e-mails, geen antwoorden/);
    expect(readme).toMatch(/about 30 of these a day per inbox/);
    expect(readme).toMatch(/New Outlook for Windows/);
    expect(readme).toMatch(/Outlook voor Mac/);
    for (const [name, bytes] of Object.entries(files)) {
      if (!name.endsWith(".eml")) continue;
      const m = await PostalMime.parse(strFromU8(bytes));
      expect(m.to?.[0].address, name).toMatch(/@/);
      expect(m.text, name).toBeTruthy();
    }
    const follow = await PostalMime.parse(strFromU8(files["step-2-follow-up/bakkerij-vos_sanne.eml"]));
    expect(follow.text).toContain("Just bumping this up.");
  });

  it("mail merge: a CSV with the five columns and the instructions, only when asked", () => {
    const files = unzipSync(buildOutlookZip({ campaign: "C", leads, mailMerge: true }));
    expect(files["MAIL-MERGE.txt"]).toBeDefined();
    expect(strFromU8(files["MAIL-MERGE.txt"])).toMatch(/classic Outlook for Windows only/);
    expect([...files["mail-merge.csv"].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel and Word
    const csv = strFromU8(files["mail-merge.csv"]).replace(/^\ufeff/, "");
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });
    expect(parsed.meta.fields).toEqual(["email", "subject", "full_email", "first_name", "company"]);
    expect(parsed.data[0]).toMatchObject({ email: "sanne@bakkerijvos.nl", first_name: "Sanne", company: "Bakkerij Vos" });
    expect(parsed.data[0].full_email).toContain("second shop in Utrecht-Oost");
    expect(mailMergeCsv([]).length).toBeGreaterThan(1);
  });
});
