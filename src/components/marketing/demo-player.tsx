"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Plays the hero demo once, when it scrolls into view (on a phone it's below the first screen).
 * Before this runs, and with prefers-reduced-motion, the finished demo is shown as is.
 */
export function DemoPlayer({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    el.classList.add("demo-armed");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.classList.add("demo-play");
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    // Never leave it hidden: if the scroll trigger hasn't fired after 15 s (some embedded or hidden
    // browsers never report it), play it anyway.
    const fallback = window.setTimeout(() => el.classList.add("demo-play"), 15_000);
    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
    };
  }, []);
  return <div ref={ref}>{children}</div>;
}
