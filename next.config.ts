import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Local sign-in tests build into .next-local so they never overwrite the normal build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Server-only Node packages: keep them out of the bundle.
  serverExternalPackages: ["pg", "pg-boss", "@polar-sh/sdk"],
  partialPrefetching: true,
  experimental: {
    // CSV uploads are sent to a Server Action; 20k rows fit well within this.
    serverActions: { bodySizeLimit: "12mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
