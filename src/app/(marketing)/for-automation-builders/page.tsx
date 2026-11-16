import type { Metadata } from "next";
import { PersonaView } from "@/components/marketing/persona-view";
import { LANGUAGE_PAIRS, marketingMetadata } from "@/content/meta";
import { AUTOMATION } from "@/content/personas";

const pair = LANGUAGE_PAIRS.automation;

export const metadata: Metadata = marketingMetadata("automation", pair.en, pair);

export default function AutomationPage() {
  return <PersonaView t={AUTOMATION.en} locale="en" alternate={pair.nl} />;
}
