// The campaign page as four steps (review C6, 2026-11-26): set up → free preview → run → send.
// Pure, so the rules are tested: which steps are done, and which one is open now.

export type StepKey = "setup" | "preview" | "run" | "send";
export const STEP_KEYS: StepKey[] = ["setup", "preview", "run", "send"];

export type StepFacts = {
  /** A template with at least one valid slot is chosen. */
  templateOk: boolean;
  /** Leads in the free preview (0 = never run). */
  previewCount: number;
  /** Leads written or given the free fallback line. */
  written: number;
  /** Leads still to run (queued or failed). */
  remaining: number;
  /** A run is going right now. */
  inFlight: boolean;
  /** The run has been started at least once (running or done). */
  started: boolean;
};

export type StepState = { done: Record<StepKey, boolean>; current: StepKey };

export function campaignSteps(f: StepFacts): StepState {
  const done: Record<StepKey, boolean> = {
    setup: f.templateOk,
    // Running without a preview is allowed; once a run started, the preview step is behind you.
    preview: f.templateOk && (f.previewCount > 0 || f.started),
    run: f.written > 0 && f.remaining === 0 && !f.inFlight,
    // Sending has no end state here: once the run is done, this step stays open.
    send: false,
  };
  const current: StepKey = f.inFlight
    ? "run"
    : (STEP_KEYS.find((k) => !done[k]) ?? "send");
  return { done, current };
}
