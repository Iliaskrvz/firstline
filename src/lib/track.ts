// Analytics events (Plausible). Calls are no-ops when the Plausible script isn't loaded, so the app
// works the same without analytics. Events carry no personal data: no emails, names or websites.
export type TrackEvent = "Demo used" | "Signup" | "First campaign" | "First purchase";

declare global {
  interface Window {
    plausible?: ((event: string, options?: { props?: Record<string, string | number | boolean> }) => void) & { q?: unknown[] };
  }
}

export function track(event: TrackEvent, props?: Record<string, string | number | boolean>) {
  if (typeof window === "undefined") return;
  try {
    window.plausible?.(event, props ? { props } : undefined);
  } catch {
    // analytics must never break the page
  }
}
