import type { Metadata } from "next";
import { PersonaView } from "@/components/marketing/persona-view";
import { LANGUAGE_PAIRS, marketingMetadata } from "@/content/meta";
import { SMALL_BUSINESS } from "@/content/personas";

const pair = LANGUAGE_PAIRS.smallBusiness;

export const metadata: Metadata = marketingMetadata("smallBusiness", pair.en, pair);

export default function SmallBusinessPage() {
  return <PersonaView t={SMALL_BUSINESS.en} locale="en" alternate={pair.nl} />;
}
