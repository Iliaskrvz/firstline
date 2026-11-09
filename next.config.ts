import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Server-only Node packages: keep them out of the bundle.
  serverExternalPackages: ["pg", "pg-boss"],
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
