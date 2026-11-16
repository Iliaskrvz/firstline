import type { Metadata } from "next";
import Link from "next/link";
import { Calculator } from "@/components/marketing/calculator";
import { CtaBand, Eyebrow, H1, MarketingShell, Section } from "@/components/marketing/site";
import { CALCULATOR } from "@/content/calculator";
import { COMPARE } from "@/content/compare";
import { COMPETITORS, checkedOnLabel } from "@/content/competitors";
import { marketingMetadata } from "@/content/meta";
import { PACK_CONFIG } from "@/config/packs";

export const metadata: Metadata = marketingMetadata("calculator", "/calculator");

export default function CalculatorPage() {
  const t = CALCULATOR;
  return (
    <MarketingShell locale="en">
      <Section className="pb-6 md:pb-8">
        <Eyebrow n={1}>{t.eyebrow}</Eyebrow>
        <H1 className="mt-3">{t.title}</H1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-700">{t.intro}</p>
      </Section>
      <Section className="pt-0 md:pt-0">
        <Calculator
          packs={PACK_CONFIG.filter((p) => p.enabled && p.kind === "standard")}
          competitors={COMPETITORS}
        />
        <p className="mt-6 text-sm text-slate-600">
          {COMPARE.checkedOn(checkedOnLabel())}{" "}
          <Link href="/compare" className="font-medium text-brand-800 underline decoration-brand-200 underline-offset-2">
            {t.compareLink} ›
          </Link>
        </p>
      </Section>
      <CtaBand title={t.cta.title} sub={t.cta.sub} cta={t.cta.cta} />
    </MarketingShell>
  );
}
