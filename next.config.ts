import type { NextConfig } from "next";

// Security headers on every response. No script CSP: the pages use inline scripts (Next, Turnstile,
// Plausible), so a script policy would need nonces; these headers cover framing, sniffing and leaks.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
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
