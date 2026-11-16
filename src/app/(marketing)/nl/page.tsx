import type { Metadata } from "next";
import { HomeView } from "@/components/marketing/home-view";
import { HOME_NL } from "@/content/home.nl";
import { homeMetadata } from "@/content/meta";

export const metadata: Metadata = homeMetadata(HOME_NL, "nl");

export default function HomeNl() {
  return <HomeView t={HOME_NL} locale="nl" />;
}
