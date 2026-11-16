import { ImageResponse } from "next/og";

// iOS home-screen icon: the same mark as icon.svg, rendered at build time.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: "#020617", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <div style={{ color: "white", fontSize: 112, fontWeight: 700, lineHeight: 1, fontFamily: "sans-serif" }}>F</div>
        <div style={{ position: "absolute", right: 30, bottom: 30, width: 22, height: 22, borderRadius: 11, background: "#f65d1d" }} />
      </div>
    ),
    size,
  );
}
