// Runs once when the Next.js server starts.
import { missingEnv, missingEnvMessage } from "@/lib/env";

export function register() {
  // The web app can't run without Supabase: stop with a clear message.
  const app = missingEnv(process.env, ["app"]);
  if (app.length) throw new Error(missingEnvMessage(app));

  // Everything else only limits features (preview runs, AI writing), so warn and keep running.
  const optional = missingEnv(process.env, ["database", "firecrawl"]);
  if (process.env.LLM_PROVIDER === "anthropic") optional.push(...missingEnv(process.env, ["anthropic"]));
  if (optional.length) console.warn(`\n⚠ FirstLine: ${missingEnvMessage(optional)}\n`);
}
