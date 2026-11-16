import { ImageResponse } from "next/og";
import { HOME } from "@/content/home";

// The share image (Slack, LinkedIn, X): rendered at build time from the homepage copy, no image files.
export const alt = HOME.meta.ogTitle;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#fbfaf7", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, fontFamily: "serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 52, height: 52, borderRadius: 12, background: "#020617", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, fontWeight: 700, fontFamily: "sans-serif" }}>
            F
          </div>
          <div style={{ fontSize: 34, fontWeight: 600, color: "#0f172a", fontFamily: "sans-serif" }}>FirstLine</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 68, lineHeight: 1.08, color: "#0f172a", display: "flex" }}>{HOME.hero.headline}</div>
          <div style={{ fontSize: 44, lineHeight: 1.15, color: "#475569", marginTop: 16 }}>{HOME.hero.headlineMuted}</div>
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#475569", fontFamily: "monospace", borderTop: "2px solid #e2e8f0", paddingTop: 20 }}>
          <span style={{ color: "#bd3410", marginRight: 10 }}>[1]</span>
          {HOME.hero.footnote}
        </div>
      </div>
    ),
    size,
  );
}
