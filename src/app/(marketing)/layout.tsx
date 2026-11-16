// Marketing pages: the display face (a research paper with footnotes, the [n] motif) and the paper background.
import { Newsreader } from "next/font/google";

const display = Newsreader({ subsets: ["latin"], variable: "--font-display", display: "swap" });

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return <div className={`${display.variable} bg-paper min-h-screen text-slate-900`}>{children}</div>;
}
