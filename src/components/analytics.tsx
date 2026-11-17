// Plausible Analytics: cookie-free, EU-hosted. Loaded only when PLAUSIBLE_SCRIPT_URL is set (copy the
// script address from your Plausible site settings). Works with both snippet formats: the per-site
// script (pa-….js, set up with plausible.init) and the older one with data-domain (PLAUSIBLE_DOMAIN).
import Script from "next/script";

const STUB =
  "window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)};" +
  "plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()";

export function Analytics({ env = process.env }: { env?: Record<string, string | undefined> }) {
  const src = env.PLAUSIBLE_SCRIPT_URL?.trim();
  if (!src || !/^https:\/\/[^\s"'<>]+$/.test(src)) return null;
  const domain = env.PLAUSIBLE_DOMAIN?.trim();
  return (
    <>
      <Script id="plausible-init" strategy="afterInteractive">
        {STUB}
      </Script>
      <Script src={src} strategy="afterInteractive" {...(domain ? { "data-domain": domain } : {})} />
    </>
  );
}
