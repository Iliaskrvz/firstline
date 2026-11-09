// Minimal robots.txt support: groups by user-agent, longest-match Allow/Disallow,
// with * and $ wildcards (RFC 9309).

type Rule = { allow: boolean; pattern: string };
export type Robots = { groups: { agents: string[]; rules: Rule[] }[] };

export function parseRobots(text: string): Robots {
  const groups: Robots["groups"] = [];
  let current: Robots["groups"][number] | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      lastWasAgent = false;
      if (key === "disallow" && value === "") continue; // "Disallow:" = allow all
      current.rules.push({ allow: key === "allow", pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  return { groups };
}

function toRegex(pattern: string) {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export function isAllowed(robots: Robots, userAgent: string, path: string): boolean {
  const ua = userAgent.toLowerCase();
  const specific = robots.groups.filter((g) => g.agents.some((a) => a !== "*" && ua.includes(a)));
  const group = specific.length ? specific : robots.groups.filter((g) => g.agents.includes("*"));
  const rules = group.flatMap((g) => g.rules);
  let best: Rule | null = null;
  for (const r of rules) {
    if (!toRegex(r.pattern).test(path)) continue;
    const len = r.pattern.replace(/\$$/, "").length;
    const bestLen = best ? best.pattern.replace(/\$$/, "").length : -1;
    if (len > bestLen || (len === bestLen && r.allow)) best = r;
  }
  return best ? best.allow : true;
}
