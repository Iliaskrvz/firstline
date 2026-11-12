// Deep research is built but OFF: not shown, not sold, not available in the API, until the lawyer
// has answered the 4 questions and Anthropic has confirmed in writing that it fits their Usage
// Policy (owner's decision, 2026-11-12). Turning it on: DEEP_RESEARCH_ENABLED=1 in .env.local.
export function deepEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DEEP_RESEARCH_ENABLED === "1";
}
