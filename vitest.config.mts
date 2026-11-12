import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "supabase/tests/**/*.test.ts", "apps-script/**/*.test.ts", "integrations/make-app/**/*.test.ts"],
    environment: "node",
    setupFiles: ["supabase/tests/vitest-setup.ts"],
    testTimeout: 30_000,
  },
});
