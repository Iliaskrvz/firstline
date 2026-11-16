import type { Metadata } from "next";
import { HomeView } from "@/components/marketing/home-view";
import { HOME } from "@/content/home";
import { homeMetadata } from "@/content/meta";

export const metadata: Metadata = homeMetadata(HOME, "en");

export default function Home() {
  return <HomeView t={HOME} locale="en" />;
}
