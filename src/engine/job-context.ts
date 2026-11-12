// Which workspace a piece of engine work is for, and how urgent it is, without passing it through
// every function: the worker runs each lead inside jobContext.run(...), and the shared provider
// limits read it to share slots fairly. Outside a job (tests, the Quality Lab) there is no context.
import { AsyncLocalStorage } from "node:async_hooks";

export type JobContext = { workspaceId: string; priority: number };

/** Free 5-lead previews go first, so a preview stays fast while a big run is going. */
export const PRIORITY = { preview: 10, run: 0, background: -5 } as const;

export const jobContext = new AsyncLocalStorage<JobContext>();

export function currentJob(): JobContext {
  return jobContext.getStore() ?? { workspaceId: "system", priority: PRIORITY.background };
}
