// Skill versions (§6). The writer prompt, rules and moves are versioned so a new
// version can be compared with the live one in the Quality Lab before it ships.
import { SKILL_V1_MOVES, SKILL_V1_PROMPT, SKILL_V1_RULES, SKILL_VERSION } from "./prompts/skill-v1";

export type Skill = { version: string; prompt: string; rules: unknown; moves: Record<string, string>; changelog: string };

export const SKILLS: Record<string, Skill> = {
  "1.0": { version: "1.0", prompt: SKILL_V1_PROMPT, rules: SKILL_V1_RULES, moves: SKILL_V1_MOVES, changelog: "Initial version" },
};

/** The version every campaign uses. A new version goes live here after it wins in the Quality Lab. */
export const LIVE_SKILL_VERSION = SKILL_VERSION;

export function skillPrompt(version: string): string {
  const s = SKILLS[version];
  if (!s) throw new Error(`Unknown skill version "${version}"`);
  return s.prompt;
}
