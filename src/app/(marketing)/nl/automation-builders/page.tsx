import type { Metadata } from "next";
import { PersonaView } from "@/components/marketing/persona-view";
import { LANGUAGE_PAIRS, marketingMetadata } from "@/content/meta";
import { AUTOMATION } from "@/content/personas";

const pair = LANGUAGE_PAIRS.automation;

export const metadata: Metadata = marketingMetadata("automationNl", pair.nl, pair);

export default function AutomationNlPage() {
  return <PersonaView t={AUTOMATION.nl} locale="nl" alternate={pair.en} />;
}
