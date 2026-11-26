// The campaign page's right-hand column as four steps (review C6). Finished steps fold away with a
// check mark and a one-line summary, the current step is open, later steps stay folded but can be
// opened. The cost notes sit above the steps and stay in view while scrolling (sticky under the top
// bar), so the credit estimate and the free-preview note are visible whichever step is open.
import type { ReactNode } from "react";
import { STEP_KEYS, type StepKey, type StepState } from "@/lib/campaign-steps";

export type StepView = { title: string; summary: string; body: ReactNode };

export function CampaignSteps({
  state,
  steps,
  notes,
}: {
  state: StepState;
  steps: Record<StepKey, StepView>;
  notes: ReactNode;
}) {
  return (
    <div className="space-y-3">
      {/* The cost notes stay in view (below the app's top bar) while any step is scrolled through. */}
      <div className="sticky top-[4.25rem] z-[5] rounded-xl bg-white">{notes}</div>
      <ol className="space-y-3">
        {STEP_KEYS.map((key, i) => {
          const s = steps[key];
          const done = state.done[key];
          const current = state.current === key;
          return (
            <li key={key}>
              <details
                open={current}
                className={`group rounded-2xl bg-white ring-1 ${current ? "ring-2 ring-brand-300" : "ring-slate-200"}`}
                data-step={key}
                data-state={current ? "current" : done ? "done" : "later"}
              >
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <span
                    aria-hidden
                    className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                      done
                        ? "bg-emerald-600 text-white"
                        : current
                          ? "bg-brand-700 text-white"
                          : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-900">
                      <span className="sr-only">
                        Step {i + 1}
                        {done ? ", done" : current ? ", current" : ""}:{" "}
                      </span>
                      {s.title}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {s.summary}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="text-slate-400 transition-transform group-open:rotate-90"
                  >
                    ›
                  </span>
                </summary>
                <div className="space-y-5 border-t border-slate-100 px-4 py-4">
                  {s.body}
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
