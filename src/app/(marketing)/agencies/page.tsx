import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/marketing/contact-form";
import { Check, Cite, Eyebrow, H1, H2, MarketingShell, Section } from "@/components/marketing/site";
import { buttonClass } from "@/components/ui";
import { AGENCIES } from "@/content/agencies";
import { marketingMetadata } from "@/content/meta";
import { fmtEuro, fmtInt } from "@/content/site";
import { enabledPacks } from "@/lib/credits";
import { turnstileSiteKey } from "@/server/demo";

export const metadata: Metadata = marketingMetadata("agencies", "/agencies");

export default function AgenciesPage() {
  const t = AGENCIES;
  const packs = enabledPacks().filter((p) => p.kind === "standard");
  return (
    <MarketingShell locale="en">
      <Section className="pt-14 md:pt-20">
        <p className="font-mono text-[13px] text-slate-600">{t.eyebrow}</p>
        <H1 className="mt-4 max-w-4xl">
          {t.title}
          <span className="mt-2 block text-slate-600">{t.titleMuted}</span>
        </H1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-700">{t.intro}</p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <a href="#contact" className={buttonClass("accent", "rounded-full px-5 py-3 text-[15px]")}>
            {t.cta} <span aria-hidden>›</span>
          </a>
          <Link href="/signup" className={buttonClass("secondary", "rounded-full px-5 py-3 text-[15px]")}>
            {t.secondary}
          </Link>
        </div>
      </Section>

      <Section>
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <Eyebrow n={1}>{t.sections.workspaces.eyebrow}</Eyebrow>
            <H2>{t.sections.workspaces.title}</H2>
          </div>
          <ul className="divide-y divide-slate-200 border-y border-slate-200">
            {t.sections.workspaces.points.map((p) => (
              <li key={p.title} className="flex gap-4 py-6">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-slate-950 text-white">
                  <Check />
                </span>
                <div>
                  <h3 className="font-semibold">{p.title}</h3>
                  <p className="mt-1.5 leading-relaxed text-slate-700">{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section className="border-y border-slate-200/80 bg-white">
        <Eyebrow n={2}>{t.sections.volume.eyebrow}</Eyebrow>
        <H2>{t.sections.volume.title}</H2>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-slate-700">{t.sections.volume.text}</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {packs.map((p) => (
            <div key={p.id} className={`rounded-2xl p-6 ring-1 ${p.id === "agency" ? "bg-slate-950 text-white ring-slate-950" : "bg-[#fbfaf7] ring-slate-200"}`}>
              <p className="font-semibold">{p.name}</p>
              <p className="font-display mt-4 text-[44px] leading-none">{fmtEuro(p.priceCents / p.credits / 100, "en", 3)}</p>
              <p className={`mt-1 text-sm ${p.id === "agency" ? "text-slate-300" : "text-slate-600"}`}>{t.sections.volume.perEmail}</p>
              <p className={`mt-4 border-t pt-3 text-sm ${p.id === "agency" ? "border-white/15 text-slate-200" : "border-slate-200 text-slate-700"}`}>
                {t.sections.volume.packLine(fmtInt(p.credits, "en"), fmtEuro(p.priceCents / 100, "en"))}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-sm text-slate-600">{t.sections.volume.note}</p>
      </Section>

      <Section>
        <div className="max-w-3xl">
          <Eyebrow n={3}>{t.sections.proof.eyebrow}</Eyebrow>
          <H2>
            {t.sections.proof.title}
            <Cite n={1} className="ml-1" />
          </H2>
          <p className="mt-4 text-[17px] leading-relaxed text-slate-700">{t.sections.proof.text}</p>
        </div>
      </Section>

      <Section id="contact" className="bg-white">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <Eyebrow n={4}>{t.form.eyebrow}</Eyebrow>
            <H2>{t.form.title}</H2>
            <p className="mt-4 text-[17px] text-slate-700">{t.form.text}</p>
          </div>
          <div className="relative">
            <ContactForm siteKey={turnstileSiteKey()} />
          </div>
        </div>
      </Section>
    </MarketingShell>
  );
}
