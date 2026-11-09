// Runs once when the Next.js server starts.
import { missingEnv, missingEnvMessage } from "@/lib/env";

export function register() {
  // The web app can't run without Supabase: stop with a clear message.
  const app = missingEnv(process.env, ["app"]);
  if (app.length) throw new Error(missingEnvMessage(app));

  // Engine keys are used by the worker (Phase 2), which refuses to start
  // without them. The web app only warns, so Phase 1 screens keep working.
  const engine = missingEnv(process.env, ["engine"]);
  if (engine.length) console.warn(`\n⚠ FirstLine: ${missingEnvMessage(engine)}\n`);
}
