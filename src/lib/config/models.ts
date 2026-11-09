// The only place model IDs live (SPEC §13). Used from Phase 2 onwards.
export const MODELS = {
  /** Fact extraction, validation, AI judge, and the "Lite" writer. */
  fast: "claude-haiku-5-5",
  /** "Pro" writer, and the 5% re-judge sample. */
  writer: "claude-sonnet-5-5",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];
