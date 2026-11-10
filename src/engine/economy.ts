// Economy mode (§9): the first write of each lead waits for a batch (50% off).
// The pipeline stays the same; the LLM it gets is wrapped:
//   - deferringLLM: the first write of step 1 is not made; it throws DeferredWriteError
//     with the request, which the pipeline stores for the next batch;
//   - prewrittenLLM: that same write returns the batch's answer instead of calling the model.
// The (rare) rewrite, follow-ups, extraction and judging run directly, so one batch round is enough.
import type { LLM, LLMResult, WriteInput } from "./llm";
import type { WriterOutput } from "./types";

export const WAITING_FOR_BATCH = "Waiting for the Economy batch (can take a few hours)";

export class DeferredWriteError extends Error {
  constructor(public input: WriteInput) {
    super("Write deferred to the Economy batch");
    this.name = "DeferredWriteError";
  }
}

/** The one write that goes through the batch: step 1, first attempt. */
export function isBatchable(input: WriteInput): boolean {
  return !input.feedback?.length && !input.followUp;
}

function wrap(llm: LLM, write: LLM["write"]): LLM {
  return {
    provider: llm.provider,
    extractorId: llm.extractorId,
    extractFacts: (i) => llm.extractFacts(i),
    judge: (i) => llm.judge(i),
    compare: llm.compare ? (i) => llm.compare!(i) : undefined,
    batch: llm.batch,
    write,
  };
}

export function deferringLLM(llm: LLM): LLM {
  return wrap(llm, async (input) => {
    if (isBatchable(input)) throw new DeferredWriteError(input);
    return llm.write(input);
  });
}

export function prewrittenLLM(llm: LLM, result: LLMResult<WriterOutput>): LLM {
  let used = false;
  return wrap(llm, async (input) => {
    if (isBatchable(input) && !used) {
      used = true;
      return result;
    }
    return llm.write(input);
  });
}
