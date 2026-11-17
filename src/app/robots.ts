// robots.txt: the marketing pages are open to search engines; the app, the API and sign-in are not.
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.PUBLIC_APP_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/auth/", "/checkout", "/campaigns", "/templates", "/inboxes", "/replies", "/credits", "/admin", "/integrations", "/settings", "/invite", "/examples"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
