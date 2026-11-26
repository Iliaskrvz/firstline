// The homepage, in either language: src/app/(marketing)/page.tsx (English) and /nl (Dutch).
// All copy comes from src/content/home.ts / home.nl.ts.
import Link from "next/link";
import { Suspense, type CSSProperties } from "react";
import { CaseStudyCard } from "@/components/marketing/case-study";
import { DemoPlayer } from "@/components/marketing/demo-player";
import { LiveDemo } from "@/components/marketing/live-demo";
import { hasTestimonials, LiveCounter, LogoStrip, Testimonials } from "@/components/marketing/proof-blocks";
import { Check, Cite, Eyebrow, H2, MarketingShell, WindowDots } from "@/components/marketing/site";
import { buttonClass } from "@/components/ui";
import { COMPETITORS, checkedOnLabel } from "@/content/competitors";
import type { HomeCopy } from "@/content/home";
import { CASE_STUDIES, DEMO_VIDEO } from "@/content/proof";
import { refundOffer } from "@/content/refund";
import { fmtEuro, fmtInt, type Locale } from "@/content/site";
import { enabledPacks } from "@/lib/credits";
import { visibleProof } from "@/lib/proof";
import { demoMode, turnstileSiteKey } from "@/server/demo";

const TONE = { brand: "bg-brand-50 text-brand-800", blue: "bg-blue-50 text-blue-800", gray: "bg-slate-100 text-slate-700" } as const;

const at = (s: number): CSSProperties => ({ animationDelay: `${s}s` });

/**
 * The hero demo, one orchestrated animation on load (CSS only): the fact gets marked on the company's
 * page, the opener is written word by word, then its footnote and source appear. With
 * prefers-reduced-motion everything is shown at once (globals.css).
 */
function HeroDemo({ t }: { t: HomeCopy }) {
  const d = t.demo;
  const words = d.opener.split(" ");
  const start = 1.6;
  const step = 0.09;
  const done = start + words.length * step;
  return (
    <figure className="relative" aria-label={t.visuals.demoLabel}>
      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_18px_50px_rgb(15_23_42/0.10)] ring-1 ring-slate-200">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5">
          <WindowDots />
          <span className="truncate rounded-md bg-slate-100 px-2.5 py-1 font-mono text-[11px] text-slate-600">{d.url}</span>
        </div>
        <div className="space-y-2 px-5 py-4 text-[13px] leading-relaxed text-slate-600" lang="nl">
          <p className="font-display text-lg font-medium text-slate-900">{d.pageTitle}</p>
          <p>{d.before}</p>
          <p>
            <span className="demo-mark rounded px-0.5 text-slate-900">{d.fact}</span>{" "}
            <span className="demo-in cite text-xs" style={at(1.3)}>
              {d.factId}
            </span>
          </p>
          <p>{d.after}</p>
        </div>
      </div>
      <div className="relative -mt-3 ml-6 rounded-2xl bg-white p-5 shadow-[0_24px_60px_rgb(15_23_42/0.14)] ring-1 ring-slate-200 sm:ml-12">
        <p className="font-mono text-[11px] text-slate-500">{d.emailLabel}</p>
        <div className="mt-3 space-y-2.5 text-[14px] leading-relaxed text-slate-700">
          <p>{d.greeting}</p>
          <p className="text-slate-900">
            {words.map((w, i) => (
              <span key={i} className="demo-in" style={at(start + i * step)}>
                {w}{" "}
              </span>
            ))}
            <span className="demo-in" style={at(done + 0.15)}>
              <Cite n={1} />
            </span>
          </p>
          <p>{d.rest}</p>
        </div>
        <p className="demo-in mt-4 border-t border-dashed border-slate-200 pt-3 font-mono text-[11px] text-slate-600" style={at(done + 0.45)}>
          <span className="text-brand-700">[1]</span> {d.factId} · {d.source} · &ldquo;<span lang="nl">{d.fact.replace(/\.$/, "")}</span>&rdquo;
        </p>
      </div>
    </figure>
  );
}

/** The preview screen of a campaign: leads (a table; stacked cards on a phone) and one written email with its sources. */
function ProductWindow({ t }: { t: HomeCopy }) {
  const v = t.visuals;
  return (
    <div className="rounded-[28px] bg-white/60 p-2 ring-1 ring-slate-200/80 sm:p-3">
      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgb(15_23_42/0.08)] ring-1 ring-slate-200/80">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <WindowDots />
          <span className="truncate text-xs text-slate-600">{v.windowTitle}</span>
        </div>
        <div className="grid lg:grid-cols-[1.45fr_1fr]">
          <div className="min-w-0 p-5 sm:p-6 lg:border-r lg:border-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold">{v.campaign}</p>
                <p className="mt-0.5 text-xs text-slate-600">{v.campaignMeta}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800">{v.written}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">{v.neutral}</span>
              </div>
            </div>
            <ul className="mt-4 space-y-2 sm:hidden">
              {v.leads.map((l) => (
                <li key={l.name} className="rounded-xl p-3 text-[13px] ring-1 ring-slate-200">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{l.name}</p>
                      <p className="text-xs text-slate-600">
                        {l.company} · {l.site}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-600">
                      {l.facts} {v.factsWord}
                    </span>
                  </div>
                  <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs ${TONE[l.tone]}`}>{l.status}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 hidden sm:block">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="text-left text-slate-600">
                    {v.columns.map((c, i) => (
                      <th key={c} className={`py-2 font-medium ${i === 3 ? "text-right" : ""}`}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {v.leads.map((l) => (
                    <tr key={l.name} className="border-t border-slate-100">
                      <td className="py-3">
                        <p className="font-medium">{l.name}</p>
                        <p className="text-xs text-slate-600">{l.company}</p>
                      </td>
                      <td className="py-3 text-slate-600">{l.site}</td>
                      <td className="py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs ${TONE[l.tone]}`}>{l.status}</span>
                      </td>
                      <td className="py-3 text-right text-slate-600">{l.facts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="min-w-0 border-t border-slate-100 bg-[#fbfaf7] p-5 sm:p-6 lg:border-t-0">
            <p className="text-xs text-slate-600">{v.emailMeta}</p>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-700">
              <p>{t.demo.greeting}</p>
              <p>
                <mark className="rounded bg-brand-100 px-1 text-brand-950">{t.demo.opener}</mark>
                <Cite n={1} className="ml-0.5" />
              </p>
              <p>{t.demo.rest}</p>
              <p>{v.signOff}</p>
            </div>
            <p className="mt-5 font-mono text-[11px] text-slate-600">{v.sourcesTitle}</p>
            <ul className="mt-2.5 space-y-2 text-[13px]">
              <li className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200">
                <span className="cite text-xs">F1</span>{" "}
                <span className="text-slate-600" lang="nl">
                  &ldquo;Ambachtelijk brood sinds 1987&rdquo;
                </span>{" "}
                <span className="text-slate-600">· /over-ons</span>
              </li>
              <li className="rounded-xl bg-white px-3 py-2.5 ring-2 ring-brand-500">
                <span className="cite text-xs">
                  [1] F2 · {v.used}
                </span>{" "}
                <span className="text-slate-800" lang="nl">
                  &ldquo;Vanaf 1 maart ook in Utrecht-Oost&rdquo;
                </span>{" "}
                <span className="text-slate-600">· /nieuws</span>
              </li>
              <li className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-emerald-800 ring-1 ring-slate-200">
                <Check className="size-4" /> {v.reviewer}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepVisual({ i, t }: { i: number; t: HomeCopy }) {
  const v = t.visuals;
  const rows = (list: string[][], tones: string[]) => (
    <div className="space-y-1.5">
      {list.map(([left, right], k) => (
        <div key={left} className="flex justify-between gap-2">
          <span className="truncate">{left}</span>
          <span className={`shrink-0 ${tones[k]}`}>{right}</span>
        </div>
      ))}
    </div>
  );
  if (i === 0)
    return (
      <p className="font-mono text-[11px] leading-[1.75] text-slate-700">
        first_name, website
        <br />
        Sanne, bakkerijvos.nl
        <br />
        Joris, zuurdesemhuis.nl
      </p>
    );
  if (i === 1)
    return (
      <p>
        {v.templateLines[0]}
        <br />
        <span className="tok-slot">[[opener]]</span>
        <br />
        {v.templateLines[1]}
      </p>
    );
  if (i === 2) return rows(v.readRows, ["text-emerald-800", "text-emerald-800", "text-brand-700"]);
  return rows(v.sendRows, ["text-emerald-800", "text-slate-600", "text-brand-700"]);
}

/** Splits a sentence into two lines of similar length, for the code sample. */
function twoLines(s: string) {
  const words = s.split(" ");
  const half = Math.ceil(words.length / 2);
  return `${words.slice(0, half).join(" ")}\n      ${words.slice(half).join(" ")}`;
}

export function HomeView({ t, locale }: { t: HomeCopy; locale: Locale }) {
  const packs = enabledPacks().filter((p) => p.kind === "standard").slice(0, 3);
  const perEmail = (p: (typeof packs)[number]) => Math.round((p.priceCents / p.credits) * 10) / 1000;
  const base = packs.length ? perEmail(packs[0]) : 0;
  const anchor = COMPETITORS.filter((c) => c.inAnchor && c.for300);
  const demo = demoMode();
  const cases = visibleProof(CASE_STUDIES);
  const signup = "/signup";
  // Section labels count up ([1], [2], …), skipping sections that are switched off.
  let section = 0;
  const n = () => ++section;
  return (
    <MarketingShell locale={locale} alternate={locale === "en" ? "/nl" : "/"}>
      {/* Hero */}
      <section className="relative">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-12 sm:px-6 md:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
          <div>
            <h1 className={`font-display text-[40px] leading-[1.05] font-medium tracking-tight sm:text-[54px] ${locale === "nl" ? "lg:text-[52px]" : "lg:text-[60px]"}`}>
              {t.hero.headline}
              <Cite n={1} className="ml-1" />
              <span className="mt-2 block text-slate-600">{t.hero.headlineMuted}</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-700">{t.hero.sub}</p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href={signup} className={buttonClass("accent", "rounded-full px-5 py-3 text-[15px]")}>
                {t.hero.cta} <span aria-hidden>›</span>
              </Link>
              <a href="#pricing" className={buttonClass("secondary", "rounded-full px-5 py-3 text-[15px]")}>
                {t.hero.secondary}
              </a>
            </div>
            <p className="mt-3 text-sm text-slate-600">{t.hero.note}</p>
            <p className="mt-1 text-sm font-medium text-slate-800">{t.hero.free}</p>
            <p className="mt-8 border-t border-slate-200 pt-3 font-mono text-[12px] text-slate-600">
              <span className="text-brand-700">[1]</span> {t.hero.footnote}
            </p>
          </div>
          <DemoPlayer>
            <HeroDemo t={t} />
          </DemoPlayer>
        </div>
        {/* Integrations: names as text (no logo files used) */}
        <div className="border-y border-slate-200/80">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-5 sm:px-6">
            <span className="font-mono text-[12px] text-slate-600">{t.integrations.label}</span>
            <ul className="flex flex-wrap gap-x-7 gap-y-2 text-[15px] font-semibold text-slate-700">
              {t.integrations.names.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        </div>
        {/* Social proof: renders nothing unless SHOW_PROOF lets real entries through */}
        <div className="mx-auto max-w-6xl space-y-4 px-4 empty:hidden sm:px-6 [&>*:first-child]:mt-6">
          <Suspense fallback={null}>
            <LiveCounter t={t.proof} locale={locale} />
          </Suspense>
          <LogoStrip t={t.proof} />
        </div>
      </section>

      {/* Live demo: only when it's switched on (else the hero's static example is the demo) */}
      {demo !== "off" && (
        <section id="try" className="scroll-mt-20 pt-20 md:pt-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Eyebrow n={n()}>{t.liveDemo.eyebrow}</Eyebrow>
            <H2>{t.liveDemo.title}</H2>
            <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-slate-700">{t.liveDemo.text}</p>
            <div className="mt-8">
              <LiveDemo t={t.liveDemo} lang={locale} siteKey={turnstileSiteKey()} test={demo === "test"} />
            </div>
          </div>
        </section>
      )}

      {/* Problem: an editorial list, not cards */}
      <section className="py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <Eyebrow n={n()}>{t.problem.eyebrow}</Eyebrow>
            <H2>{t.problem.title}</H2>
          </div>
          <ol className="divide-y divide-slate-200 border-y border-slate-200">
            {t.problem.items.map((p, i) => (
              <li key={p.title} className="grid grid-cols-[3rem_1fr] gap-4 py-7">
                <span className="font-display text-4xl leading-none text-brand-700">{i + 1}</span>
                <div>
                  <h3 className="text-lg font-semibold">{p.title}</h3>
                  <p className="mt-2 leading-relaxed text-slate-700">{p.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* How it works: four steps with a picture each */}
      <section id="how" className="scroll-mt-20 bg-white py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Eyebrow n={n()}>{t.how.eyebrow}</Eyebrow>
          <H2>{t.how.title}</H2>
          <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl bg-slate-200 ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-4">
            {t.how.steps.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-4 bg-white p-6">
                <span className="flex items-center justify-between gap-2">
                  <span className="cite text-sm">[{i + 1}]</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">{s.time}</span>
                </span>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="text-sm leading-relaxed text-slate-700">{s.text}</p>
                <div className="mt-auto rounded-xl bg-[#fbfaf7] p-3 text-xs leading-relaxed text-slate-700 ring-1 ring-slate-200">
                  <StepVisual i={i} t={t} />
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Demo video: hidden until src/content/proof.ts has one */}
      {DEMO_VIDEO.src && (
        <section id="video" className="scroll-mt-20 py-20 md:py-28">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <Eyebrow n={n()}>{t.video.eyebrow}</Eyebrow>
              <H2>{t.video.title}</H2>
              <p className="mt-3 text-[17px] leading-relaxed text-slate-700">
                {t.video.text} <span className="text-slate-500">({DEMO_VIDEO.durationLabel})</span>
              </p>
            </div>
            <video
              className="w-full rounded-2xl bg-slate-950 ring-1 ring-slate-200"
              controls
              preload="none"
              playsInline
              poster={DEMO_VIDEO.poster ?? undefined}
              aria-label={t.video.label}
            >
              <source src={DEMO_VIDEO.src} type="video/mp4" />
              {DEMO_VIDEO.captions && <track kind="captions" src={DEMO_VIDEO.captions} srcLang={locale} label={locale === "nl" ? "Nederlands" : "English"} default />}
            </video>
          </div>
        </section>
      )}

      {/* Trust: the claim, then the screen that proves it */}
      <section id="proof" className="scroll-mt-20 py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-start">
            <div>
              <Eyebrow n={n()}>{t.trust.eyebrow}</Eyebrow>
              <H2>
                {t.trust.title}
                <Cite n={1} className="ml-1" />
              </H2>
            </div>
            <div className="lg:pt-9">
              <p className="leading-relaxed text-slate-700">{t.trust.body}</p>
              <ul className="mt-5 space-y-2.5 text-[15px]">
                {t.trust.points.map((x) => (
                  <li key={x} className="flex items-center gap-3">
                    <span className="grid size-6 place-items-center rounded-md bg-slate-950 text-white">
                      <Check />
                    </span>
                    {x}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-12">
            <ProductWindow t={t} />
            <p className="mt-3 font-mono text-[12px] text-slate-600">
              <span className="text-brand-700">[1]</span> {t.preview.title}. {t.preview.text}
            </p>
          </div>
          {/* Case studies: hidden behind SHOW_PROOF, placeholders never in production */}
          {cases.length > 0 && (
            <div className="mt-14 grid gap-6">
              <Eyebrow n="†">{t.caseStudy.eyebrow}</Eyebrow>
              {cases.map((c, i) => (
                <CaseStudyCard key={i} c={c} t={t.caseStudy} locale={locale} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Objections: four doubts, one sentence each, one link to the proof */}
      <section id="doubts" className="scroll-mt-20 border-y border-slate-200/80 bg-white py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Eyebrow n={n()}>{t.objections.eyebrow}</Eyebrow>
          <H2>{t.objections.title}</H2>
          <dl className="mt-10 grid gap-x-12 gap-y-10 md:grid-cols-2">
            {t.objections.items.map((o) => (
              <div key={o.q} className="border-t border-slate-200 pt-5">
                <dt className="font-display text-[24px] leading-snug text-slate-900">{o.q}</dt>
                <dd className="mt-2 leading-relaxed text-slate-700">
                  {o.a}{" "}
                  <Link href={o.link.href as "/"} className="font-medium whitespace-nowrap text-brand-800 underline decoration-brand-200 underline-offset-2 hover:decoration-brand-700">
                    {o.link.label} <span aria-hidden>›</span>
                  </Link>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {hasTestimonials() && <Testimonials t={t.proof} n={n()} />}

      {/* API (dark) */}
      <section id="api" className="bg-grid-dark scroll-mt-16 bg-slate-950 py-20 text-white md:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.25fr]">
          <div>
            <Eyebrow n={n()} dark>
              {t.api.eyebrow}
            </Eyebrow>
            <H2>{t.api.title}</H2>
            <p className="mt-4 max-w-md text-[17px] leading-relaxed text-slate-300">{t.api.body}</p>
            <Link href="/docs/api" className="mt-6 inline-flex rounded-full px-[18px] py-2.5 text-sm font-medium text-white ring-1 ring-white/30 hover:bg-white/5">
              {t.api.cta} <span aria-hidden className="ml-1">›</span>
            </Link>
          </div>
          <div className="min-w-0 overflow-hidden rounded-2xl bg-[#0b1220] ring-1 ring-white/10">
            <div className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3 text-xs text-slate-400">
              <WindowDots dark />
              <span>POST /api/v1/personalize</span>
            </div>
            <pre className="max-w-full overflow-x-auto p-5 font-mono text-[12.5px] leading-[1.7] text-slate-300" tabIndex={0} aria-label={t.visuals.apiLabel}>
              {`curl -X POST $FIRSTLINE/api/v1/personalize \\
  -H "Authorization: Bearer $FIRSTLINE_KEY" \\
  -d '{"lead": {"email": "sanne@bakkerijvos.nl",
              "website": "bakkerijvos.nl"},
       "campaign_id": "…", "wait": 60}'

`}
              <span className="text-slate-400">{"// 200 OK"}</span>
              {`
{
  "status": "done",
  "result": {
    "status": "personalised",
    "slots": { "opener": `}
              <span className="text-brand-300">{`"${twoLines(t.demo.opener)}"`}</span>
              {` },
    "sources": [{ "fact": "Vanaf 1 maart ook in Utrecht-Oost",
                  "url": `}
              <span className="text-brand-300">{`"https://bakkerijvos.nl/nieuws"`}</span>
              {` }],
    "credits_used": 1
  }
}`}
            </pre>
          </div>
        </div>
      </section>

      {/* Pricing: the price per email is the big number */}
      <section id="pricing" className="scroll-mt-20 py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end">
            <div>
              <Eyebrow n={n()}>{t.pricing.eyebrow}</Eyebrow>
              <H2>{t.pricing.title}</H2>
              <p className="mt-3 text-[17px] text-slate-700">{t.pricing.sub}</p>
            </div>
            <p className="text-[17px] text-slate-900">
              <strong className="font-semibold">{t.pricing.anchor}</strong> <span className="text-slate-600">{t.pricing.anchorNote}</span>
              {refundOffer() && <span className="mt-1 block text-[15px] text-emerald-800">{t.pricing.refund}</span>}
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {packs.map((p) => {
              const featured = p.id === "growth";
              const pe = perEmail(p);
              const save = base ? Math.round(((base - p.priceCents / p.credits / 100) / base) * 100) : 0;
              return (
                <div key={p.id} className={`flex flex-col rounded-3xl p-7 ${featured ? "bg-slate-950 text-white shadow-[0_24px_60px_rgb(15_23_42/0.25)]" : "bg-white ring-1 ring-slate-200"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{p.name}</h3>
                    {featured && <span className="rounded-full bg-brand-700 px-2.5 py-0.5 text-xs font-medium text-white">{t.pricing.mostPopular}</span>}
                    {!featured && save >= 10 && <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">{t.pricing.save(save)}</span>}
                  </div>
                  {t.pricing.fit[p.id] && <p className={`mt-2 text-sm leading-snug ${featured ? "text-slate-300" : "text-slate-600"}`}>{t.pricing.fit[p.id]}</p>}
                  <p className="mt-5 font-display text-[52px] leading-none font-medium tracking-tight">{fmtEuro(pe, locale, 3)}</p>
                  <p className={`mt-1 text-sm ${featured ? "text-slate-300" : "text-slate-600"}`}>{t.pricing.perEmail}</p>
                  <p className={`mt-6 border-t pt-4 text-sm ${featured ? "border-white/15 text-slate-200" : "border-slate-100 text-slate-700"}`}>
                    {t.pricing.packLine(fmtInt(p.credits, locale), fmtEuro(p.priceCents / 100, locale))} · {t.pricing.perPack}
                  </p>
                  <Link href={signup} className={buttonClass(featured ? "accent" : "secondary", "mt-6 w-full rounded-full py-2.5")}>
                    {t.pricing.buy(fmtInt(p.credits, locale))}
                  </Link>
                </div>
              );
            })}
          </div>

          {/* Competitor anchor: numbers and sources from src/content/competitors.ts */}
          <div className="mt-8 rounded-2xl bg-white p-6 ring-1 ring-slate-200">
            <p className="text-[17px]">
              <span className="text-slate-700">{t.pricing.compare.elsewhere}</span> <strong className="font-semibold">{t.pricing.compare.us}</strong>
            </p>
            <details className="group mt-3 text-sm text-slate-600">
              <summary className="cursor-pointer list-none font-mono text-[12px] text-slate-700 [&::-webkit-details-marker]:hidden">
                <span className="text-brand-700">[†]</span> {t.pricing.compare.sourcesLabel}{" "}
                <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
                  ›
                </span>
              </summary>
              <p className="mt-3">{t.pricing.compare.sourcesNote}</p>
              <ul className="mt-3 space-y-1.5" lang="en">
                {anchor.map((c) => (
                  <li key={c.id}>
                    <a href={c.source} className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900" rel="noopener nofollow" target="_blank">
                      {c.name}
                    </a>
                    : {c.for300!.plan}, {c.for300!.currency}
                    {c.for300!.price}/{t.perMonth}. <span className="text-slate-500">{c.notes}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-slate-500">{t.checkedOn(checkedOnLabel(undefined, locale))}</p>
            </details>
          </div>
          <p className="mt-6 text-sm text-slate-600">{t.pricing.footnote}</p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 bg-white py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 md:grid-cols-[1fr_2fr]">
          <div>
            <Eyebrow n={n()}>{t.faq.eyebrow}</Eyebrow>
            <H2>{t.faq.title}</H2>
          </div>
          <div className="divide-y divide-slate-200 border-y border-slate-200">
            {t.faq.items.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span className="text-xl leading-none text-slate-500 transition-transform group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="mt-3 leading-relaxed text-slate-700">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing */}
      <section className="px-4 py-20 sm:px-6 md:py-24">
        <div className="bg-grid-dark mx-auto max-w-6xl rounded-[32px] bg-slate-950 px-6 py-16 text-center text-white sm:px-12 md:py-[72px]">
          <h2 className="font-display text-[34px] leading-tight font-medium tracking-tight sm:text-[46px]">{t.finalCta.title}</h2>
          <p className="mt-3 text-[17px] text-slate-300">{t.finalCta.sub}</p>
          <Link href={signup} className={buttonClass("accent", "mt-8 rounded-full px-6 py-3 text-[15px]")}>
            {t.finalCta.cta} <span aria-hidden>›</span>
          </Link>
        </div>
        <div className="mx-auto mt-10 max-w-2xl space-y-2 text-center text-[15px] text-slate-700">
          <p>{t.honestLine}</p>
          <p className="text-slate-600">{t.founderNote}</p>
        </div>
      </section>
    </MarketingShell>
  );
}
