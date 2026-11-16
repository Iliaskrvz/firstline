import type { Metadata } from "next";
import { PersonaView } from "@/components/marketing/persona-view";
import { LANGUAGE_PAIRS, marketingMetadata } from "@/content/meta";
import { SMALL_BUSINESS } from "@/content/personas";

const pair = LANGUAGE_PAIRS.smallBusiness;

export const metadata: Metadata = marketingMetadata("smallBusinessNl", pair.nl, pair);

export default function KleineBedrijvenPage() {
  return <PersonaView t={SMALL_BUSINESS.nl} locale="nl" alternate={pair.en} />;
}
