// Checks the Make app definition: valid JSON, every {{parameters.x}} exists, secrets are sanitised in
// logs, and the body the Personalise module sends is accepted by the real API validation.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normaliseSource, PersonalizeBody } from "@/api/schemas";

const dir = path.join(__dirname);
const read = (...p: string[]) => JSON.parse(readFileSync(path.join(dir, ...p), "utf8"));
const modules = readdirSync(path.join(dir, "modules"));

type Param = { name: string; options?: { nested?: Param[] }[]; spec?: Param[] | Param };
const names = (ps: Param[]): string[] => ps.flatMap((p) => [p.name, ...(p.options ?? []).flatMap((o) => names(o.nested ?? []))]);
const refs = (o: unknown) => [...JSON.stringify(o).matchAll(/parameters\.([a-z_]+)/gi)].map((m) => m[1]);

/** A tiny IML renderer for what these files use: {{parameters.x}} and {{ifempty(parameters.x, default)}}. */
function render(v: unknown, params: Record<string, unknown>): unknown {
  if (typeof v === "string") {
    const m = v.match(/^\{\{(.*)\}\}$/);
    if (!m) return v;
    const e = m[1].trim();
    const p = e.match(/^parameters\.(\w+)$/);
    if (p) return params[p[1]];
    const ie = e.match(/^ifempty\(parameters\.(\w+),\s*(.+)\)$/);
    if (ie) return params[ie[1]] ?? (ie[2].startsWith("'") ? ie[2].slice(1, -1) : Number(ie[2]));
    throw new Error(`Unsupported IML in test: ${e}`);
  }
  if (Array.isArray(v)) return v.map((x) => render(x, params));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const r = render(x, params);
      if (r !== undefined) out[k] = r; // Make leaves out undefined values
    }
    return out;
  }
  return v;
}

describe("Make app definition", () => {
  it("has a base that sends the key as a Bearer header and hides it in logs", () => {
    const base = read("base.json");
    expect(base.headers.Authorization).toBe("Bearer {{connection.apiKey}}");
    expect(base.log.sanitize).toContain("request.headers.authorization");
    const conn = read("connection", "communication.json");
    expect(conn.log.sanitize).toContain("request.headers.authorization");
    expect(refs(conn).every((r) => names(read("connection", "parameters.json")).includes(r))).toBe(true);
  });

  it.each(modules)("module %s only uses parameters it defines, and has an interface", (m) => {
    const params = names(read("modules", m, "mappable-parameters.json"));
    const comm = read("modules", m, "communication.json");
    for (const r of refs(comm)) expect(params, `${m} uses parameters.${r}`).toContain(r);
    expect(Array.isArray(read("modules", m, "interface.json"))).toBe(true);
    expect(read("modules", m, "module.json").name).toBe(m);
    expect(comm.log.sanitize).toContain("request.headers.authorization");
  });

  it("Personalise sends a body the API accepts, for both copy sources", () => {
    const comm = read("modules", "personalizeLead", "communication.json");
    const withCopy = render(comm.body, { email: "sanne@bakkerijvos.nl", first_name: "Sanne", source: "copy", subject: "Idea", body: "Hi [[opener · something from their site · 25]]" });
    const a = PersonalizeBody.safeParse(normaliseSource(withCopy));
    expect(a.success, JSON.stringify(a.error?.issues)).toBe(true);
    expect(a.data).toMatchObject({ wait: 45, options: { writer: "pro" }, copy: { subject: "Idea" } });

    const withCampaign = render(comm.body, { email: "sanne@bakkerijvos.nl", source: "campaign", campaign_id: "4b1c3f0e-7d1a-4c55-9f3e-2d8a6b0c9e11", wait: 10 });
    const b = PersonalizeBody.safeParse(normaliseSource(withCampaign));
    expect(b.success, JSON.stringify(b.error?.issues)).toBe(true);
    expect(b.data?.copy).toBeUndefined();
    expect(b.data?.campaign_id).toBe("4b1c3f0e-7d1a-4c55-9f3e-2d8a6b0c9e11");
  });
});
