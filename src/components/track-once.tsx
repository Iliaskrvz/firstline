"use client";

// Sends one analytics event when the page opens, then removes the marker from the address so a
// reload doesn't send it again (e.g. /campaigns/…?first=1, /credits?paid=1).
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { track, type TrackEvent } from "@/lib/track";

export function TrackOnce({ event, param, props }: { event: TrackEvent; param: string; props?: Record<string, string | number | boolean> }) {
  const sent = useRef(false);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    track(event, props);
    const next = new URLSearchParams(search.toString());
    next.delete(param);
    const q = next.toString();
    router.replace((q ? `${pathname}?${q}` : pathname) as "/", { scroll: false });
  }, [event, param, props, pathname, router, search]);
  return null;
}
