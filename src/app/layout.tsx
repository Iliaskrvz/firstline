import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  // Absolute URLs for canonical, hreflang and share images (the server's address in production).
  metadataBase: new URL(process.env.PUBLIC_APP_URL?.trim() || "http://localhost:3000"),
  title: { default: "FirstLine", template: "%s · FirstLine" },
  description: "Your own cold email copy, researched per lead, with a source for every line. From €0.03 per email, no subscription.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
