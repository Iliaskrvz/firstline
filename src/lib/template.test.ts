import { describe, expect, it } from "vitest";
import {
  countWords,
  formatSlot,
  hasErrors,
  parseTemplate,
  render,
  suggestSlotName,
  validateSlotDraft,
} from "./template";

const body = `Hi {{first_name}},

[[opener · a specific observation about their company from the website · 25]]

We help agencies like {{company}} automate client reporting. [[bridge | one sentence linking their situation to reporting]]

Worth a quick look?`;

const errorsFor = (b: string, s = "subj") =>
  parseTemplate({ subject: s, body: b }).issues.filter((i) => i.level === "error").map((i) => i.message);

describe("parseTemplate", () => {
  it("finds variables and slots; max words defaults to 25", () => {
    const p = parseTemplate({ subject: "Quick idea for {{company}}", body });
    expect(p.variables).toEqual(["company", "first_name"]);
    expect(p.slots).toEqual([
      { key: "opener", instruction: "a specific observation about their company from the website", max_words: 25 },
      { key: "bridge", instruction: "one sentence linking their situation to reporting", max_words: 25 },
    ]);
    expect(p.issues).toEqual([]);
    expect(hasErrors(p)).toBe(false);
  });

  it("accepts both separators and trims whitespace", () => {
    const p = parseTemplate({ subject: "s", body: "[[  a1 ·x·10 ]] [[b_2|  y  |  12  ]] [[c · z | 30 words]]" });
    expect(p.slots).toEqual([
      { key: "a1", instruction: "x", max_words: 10 },
      { key: "b_2", instruction: "y", max_words: 12 },
      { key: "c", instruction: "z", max_words: 30 },
    ]);
  });

  it("parses Dutch/German word units", () => {
    const p = parseTemplate({ subject: "s", body: "[[ps · korte ps · 12 woorden]] [[close · x · 8 Wörter]]" });
    expect(p.slots.map((s) => s.max_words)).toEqual([12, 8]);
  });

  it("names may use letters, digits and _ (any order), and are lowercased", () => {
    const p = parseTemplate({ subject: "s", body: "[[1st_line · x]] [[Opener · y]]" });
    expect(p.slots.map((s) => s.key)).toEqual(["1st_line", "opener"]);
  });

  it("auto-names literal SLOT markers", () => {
    const p = parseTemplate({ subject: "s", body: "[[SLOT · first thing · 20]] and [[slot · second]]" });
    expect(p.slots.map((s) => s.key)).toEqual(["slot_1", "slot_2"]);
  });

  it("keeps extra separators inside the instruction", () => {
    const p = parseTemplate({ subject: "s", body: "[[opener · mention a project · not the CEO · 20]]" });
    expect(p.slots[0]).toEqual({ key: "opener", instruction: "mention a project · not the CEO", max_words: 20 });
  });

  it("allows slots in the subject", () => {
    const p = parseTemplate({ subject: "[[hook · 4 word hook · 4]]", body: "Hi [[opener · x]]" });
    expect(p.slots.map((s) => s.key)).toEqual(["hook", "opener"]);
  });

  describe("errors (shown inline, never thrown)", () => {
    it("missing closer, with line number and part", () => {
      const p = parseTemplate({ subject: "s", body: "Hi,\n\n[[opener · x" });
      expect(p.issues).toEqual([
        { level: "error", part: "body", line: 3, message: 'Body, line 3: "[[opener · x…" is missing its closing "]]".' },
      ]);
    });

    it("missing closer when another marker starts first", () => {
      expect(errorsFor("Hi {{first_name [[opener · x]]")[0]).toMatch(/line 1: "\{\{first_name.*missing its closing "\}\}"/);
    });

    it("stray closers", () => {
      expect(errorsFor("ok\noops ]] there")).toEqual(['Body, line 2: "]]" without a matching "[[".']);
    });

    it("name is required and must be valid", () => {
      expect(errorsFor("[[]]")[0]).toMatch(/has no name/);
      expect(errorsFor("[[ · x · 10]]")[0]).toMatch(/has no name/);
      expect(errorsFor("[[my opener · x]]")[0]).toMatch(/letters, digits and _/);
      expect(errorsFor("[[café · x]]")[0]).toMatch(/letters, digits and _/);
    });

    it("name must be unique", () => {
      expect(errorsFor("[[opener · a]]\n[[opener · b]]")).toEqual([
        'Body, line 2: slot name "opener" is used twice. Each slot needs its own name.',
      ]);
    });

    it("instruction is required", () => {
      expect(errorsFor("[[opener]]")[0]).toMatch(/slot "opener" needs an instruction/);
      expect(errorsFor("[[opener · 20]]")[0]).toMatch(/needs an instruction/);
    });

    it("max words must be 3–80", () => {
      expect(errorsFor("[[opener · x · 2]]")[0]).toMatch(/use 3–80/);
      expect(errorsFor("[[opener · x · 81]]")[0]).toMatch(/use 3–80/);
      expect(errorsFor("[[opener · x · 3]]")).toEqual([]);
      expect(errorsFor("[[opener · x · 80]]")).toEqual([]);
    });

    it("invalid variable names", () => {
      expect(errorsFor("{{first name}} [[opener · x]]")[0]).toMatch(/not a valid variable/);
    });

    it("empty body", () => {
      expect(errorsFor("   ")).toEqual(["The email body is empty."]);
    });

    it("garbage input never throws", () => {
      for (const junk of ["[[[[", "]]]]{{}}", "[[·|·]]", "{{[[}}]]", "[[x · y · 99999999999999999999]]", "\u0000[[a·b]]"]) {
        expect(() => parseTemplate({ subject: junk, body: junk })).not.toThrow();
      }
    });
  });

  it("warnings: no slots, empty subject, unknown variables", () => {
    const w = (subject: string, b: string, vars?: string[]) =>
      parseTemplate({ subject, body: b }, { availableVariables: vars }).issues.filter((i) => i.level === "warning").map((i) => i.message);
    expect(w("s", "Plain email")[0]).toMatch(/No slots yet/);
    expect(w("", "[[opener · x]]")).toEqual(["The subject is empty."]);
    expect(w("s", "{{first_name}} {{city}} [[opener · x]]", ["first_name", "company"])).toEqual([
      "Not in your lead list: {{city}}. These will be empty.",
    ]);
  });
});

describe("Add slot helpers", () => {
  it("suggests the first free name", () => {
    expect(suggestSlotName([])).toBe("opener");
    expect(suggestSlotName(["opener"])).toBe("bridge");
    expect(suggestSlotName(["opener", "bridge", "ps"])).toBe("slot_2");
    expect(suggestSlotName(["opener", "bridge", "ps", "slot_2"])).toBe("slot_3");
  });

  it("validates the form", () => {
    expect(validateSlotDraft({ key: "opener", instruction: "x", max_words: 25 }, [])).toEqual({});
    expect(validateSlotDraft({ key: "", instruction: "", max_words: 2 }, [])).toEqual({
      key: "Give the slot a name.",
      instruction: "Say what this slot should do.",
      max_words: "3–80",
    });
    expect(validateSlotDraft({ key: "opener", instruction: "x", max_words: "25" }, ["opener"]).key).toMatch(/already used/);
    expect(validateSlotDraft({ key: "my slot", instruction: "a | b", max_words: 81 }, [])).toEqual({
      key: "Letters, digits and _ only.",
      instruction: "Leave out [ ] { } | and ·.",
      max_words: "3–80",
    });
  });

  it("inserts text that parses back to the same slot", () => {
    const text = formatSlot({ key: " Opener ", instruction: "  a line about  their work ", max_words: "20" });
    expect(text).toBe("[[opener · a line about their work · 20]]");
    expect(parseTemplate({ subject: "s", body: text }).slots).toEqual([
      { key: "opener", instruction: "a line about their work", max_words: 20 },
    ]);
  });
});

describe("render", () => {
  it("fills variables and slots and leaves copy intact", () => {
    const p = parseTemplate({ subject: "Idea for {{company}}", body: "Hi {{first_name}},\n[[opener · x]]\nBye" });
    expect(render(p.subject, { company: "Acme" })).toBe("Idea for Acme");
    expect(render(p.body, { first_name: "Anna" }, { opener: "Saw you opened a second studio in Utrecht." })).toBe(
      "Hi Anna,\nSaw you opened a second studio in Utrecht.\nBye",
    );
  });

  it("renders missing values safely", () => {
    const p = parseTemplate({ subject: "", body: "Hi {{first_name}} [[opener · x]]" });
    expect(render(p.body, {})).toBe("Hi  [[opener · x]]");
    expect(render(p.body, { first_name: "A" }, {}, (k) => `<${k}>`)).toBe("Hi A <opener>");
  });
});

describe("countWords", () => {
  it("counts words in several languages", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("Saw you opened a second studio.")).toBe(6);
    expect(countWords("Jullie zijn net verhuisd naar 's-Hertogenbosch!")).toBe(6);
    expect(countWords("Größte Bäckerei — seit 1950")).toBe(4);
  });
});
