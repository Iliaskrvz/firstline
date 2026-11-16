// The SHOW_PROOF switch for testimonials, case studies, example outputs and other proof.
//   off (default): nothing shown, pages like /examples return 404.
//   on (SHOW_PROOF=1): only real entries are shown; anything still marked placeholder never is.
//   preview (SHOW_PROOF=preview, never in production): placeholders are shown with a clear label,
//   so the layout can be checked before the real content exists.
// The pages that use it are built at deploy time, so a change needs a redeploy.

export type ProofMode = "off" | "on" | "preview";

export function proofMode(env: Record<string, string | undefined> = process.env): ProofMode {
  const v = env.SHOW_PROOF?.trim().toLowerCase();
  if (v === "preview") return env.NODE_ENV === "production" ? "off" : "preview";
  return v === "1" || v === "true" || v === "on" ? "on" : "off";
}

/** The entries a page may show in this mode. */
export function visibleProof<T extends { placeholder: boolean }>(items: readonly T[], mode: ProofMode = proofMode()): T[] {
  if (mode === "off") return [];
  if (mode === "on") return items.filter((i) => !i.placeholder);
  return [...items];
}
