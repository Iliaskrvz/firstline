import { describe, expect, it } from "vitest";
import { countWords, hasErrors, parseTemplate, render } from "./template";

const body = `Hi {{first_name}},

[[opener · a specific observation about their company from the website · 25]]

We help agencies like {{company}} automate client reporting. [[bridge | one sentence linking their situation to reporting]]

Worth a quick look?`;

describe("parseTemplate", () => {
  it("finds variables and slots with instructions and word limits", () => {
    const p = parseTemplate({ subject: "Quick idea for {{company}}", body });
    expect(p.variables).toEqual(["company", "first_name"]);
    expect(p.slots).toEqual([
      { key: "opener", instruction: "a specific observation about their company from the website", max_words: 25 },
      { key: "bridge", instruction: "one sentence linking their situation to reporting", max_words: null },
    ]);
    expect(p.issues).toEqual([]);
    expect(hasErrors(p)).toBe(false);
  });

  it("applies default word limits and parses '20 words' / Dutch 'woorden'", () => {
    const p = parseTemplate({ subject: "s", body: "[[opener · hi]] [[ps · short ps · 12 words]] [[close · x · 8 woorden]]" });
    expect(p.slots.map((s) => [s.key, s.max_words])).toEqual([
      ["opener", 25],
      ["ps", 12],
      ["close", 8],
    ]);
  });

  it("auto-names literal SLOT markers", () => {
    const p = parseTemplate({ subject: "s", body: "[[SLOT · first thing · 20]] and [[slot · second]]" });
    expect(p.slots.map((s) => s.key)).toEqual(["slot_1", "slot_2"]);
  });

  it("normalises names to lowercase and tolerates spaces", () => {
    const p = parseTemplate({ subject: "s", body: "{{ First_Name }} [[ Opener ·  x  ]]" });
    expect(p.variables).toEqual(["first_name"]);
    expect(p.slots[0].key).toBe("opener");
    expect(p.slots[0].instruction).toBe("x");
  });

  it("keeps extra separators inside the instruction", () => {
    const p = parseTemplate({ subject: "s", body: "[[opener · mention a project · not the CEO · 20]]" });
    expect(p.slots[0]).toEqual({ key: "opener", instruction: "mention a project · not the CEO", max_words: 20 });
  });

  it("allows slots in the subject", () => {
    const p = parseTemplate({ subject: "[[subject_hook · 4 word hook · 4]]", body: "Hi [[opener · x]]" });
    expect(p.slots.map((s) => s.key)).toEqual(["subject_hook", "opener"]);
  });

  describe("errors", () => {
    const errorsFor = (b: string, s = "subj") =>
      parseTemplate({ subject: s, body: b }).issues.filter((i) => i.level === "error").map((i) => i.message);

    it("unclosed markers", () => {
      expect(errorsFor("Hi [[opener · x")).toEqual([`Body: "[[" at position 4 is never closed with "]]".`]);
      expect(errorsFor("Hi {{first_name [[opener · x]]")).toEqual([`Body: "{{" at position 4 is never closed with "}}".`]);
    });

    it("stray closers", () => {
      expect(errorsFor("oops ]] there")).toEqual([`Body: stray "]]" at position 6.`]);
    });

    it("duplicate slot names", () => {
      expect(errorsFor("[[opener · a]] [[opener · b]]")).toEqual([`Slot "opener" is used twice. Each slot needs its own name.`]);
    });

    it("empty or invalid names", () => {
      expect(errorsFor("[[]]")).toHaveLength(1);
      expect(errorsFor("[[ · x · 10]]")).toHaveLength(1);
      expect(errorsFor("[[1st · x]]")[0]).toMatch(/must start with a letter/);
      expect(errorsFor("{{first name}}")[0]).toMatch(/not a valid variable name/);
    });

    it("word limits out of range", () => {
      expect(errorsFor("[[opener · x · 0]]")[0]).toMatch(/between 1 and 150/);
      expect(errorsFor("[[opener · x · 500]]")[0]).toMatch(/between 1 and 150/);
    });

    it("empty body", () => {
      expect(errorsFor("   ")).toEqual(["The email body is empty."]);
    });
  });

  describe("warnings", () => {
    it("no slots, missing instruction, empty subject, unknown variables", () => {
      const w = (subject: string, b: string, vars?: string[]) =>
        parseTemplate({ subject, body: b }, { availableVariables: vars }).issues.filter((i) => i.level === "warning").map((i) => i.message);

      expect(w("s", "Plain email")[0]).toMatch(/No \[\[slots\]\] yet/);
      expect(w("s", "[[opener]]")[0]).toMatch(/has no instruction/);
      expect(w("", "[[opener · x]]")).toEqual(["The subject is empty."]);
      expect(w("s", "{{first_name}} {{city}} [[opener · x]]", ["first_name", "company"])).toEqual([
        "Not in your lead list: {{city}}. These will be empty.",
      ]);
    });
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
