"use client";

// Cloudflare Turnstile (the "not a robot" check), rendered explicitly. Used by the homepage demo and
// the agencies form. Without a site key nothing is loaded and `token` stays null.
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void; "expired-callback"?: () => void; "error-callback"?: () => void; size?: string }) => string;
      reset: (id?: string) => void;
    };
  }
}

export function useTurnstile(siteKey: string | null) {
  const [token, setToken] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);

  const render = () => {
    if (!siteKey || !ref.current || !window.turnstile || id.current) return;
    id.current = window.turnstile.render(ref.current, {
      sitekey: siteKey,
      size: "flexible",
      callback: (t) => setToken(t),
      "expired-callback": () => setToken(null),
      "error-callback": () => setToken(null),
    });
  };
  useEffect(render);

  const reset = () => {
    setToken(null);
    if (id.current) window.turnstile?.reset(id.current);
  };

  const script = siteKey ? <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="lazyOnload" onLoad={render} /> : null;
  const widget = siteKey ? <div ref={ref} className="min-h-[65px]" /> : null;
  return { token, reset, script, widget, needed: !!siteKey };
}
