import type { Metadata } from "next";
import { Newsreader } from "next/font/google";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { DemoPlayer } from "@/components/marketing/demo-player";
import { buttonClass, Logo } from "@/components/ui";
import { COMPETITORS, checkedOnLabel } from "@/content/competitors";
import { HOME } from "@/content/home";
import { enabledPacks, euro } from "@/lib/credits";

// Display face for the marketing pages only: a research paper with footnotes (the [1] motif).
const display = Newsreader({ subsets: ["latin"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: { absolute: HOME.meta.title },
  description: HOME.meta.description,
  openGraph: { title: HOME.meta.ogTitle, description: HOME.meta.ogDescription, type: "website", siteName: "FirstLine" },
  twitter: { card: "summary_large_image", title: HOME.meta.ogTitle, description: HOME.meta.ogDescription },
};

// Example data for the product visuals (a made-up bakery campaign). Every visual mirrors a real screen.
const LEADS = [
  { name: "Sanne de Vos", company: "Bakkerij Vos", site: "bakkerijvos.nl", status: "Written · high", tone: "brand", facts: "4" },
  { name: "Joris Bakker", company: "Het Zuurdesemhuis", site: "zuurdesemhuis.nl", status: "Written · high", tone: "brand", facts: "6" },
  { name: "Lotte Peters", company: "Broodhuys Oost", site: "broodhuys.nl", status: "Writing…", tone: "blue", facts: "3" },
  { name: "Mark Smit", company: "De Korenaar", site: "dekorenaar.nl", status: "Reading website…", tone: "blue", facts: "–" },
  { name: "Eva Jansen", company: "Bakkerij Jansen", site: "bakkerijjansen.nl", status: "Neutral line · free", tone: "gray", facts: "0" },
] as const;

const TONE = { brand: "bg-brand-50 text-brand-800", blue: "bg-blue-50 text-blue-800", gray: "bg-slate-100 text-slate-700" } as const;

/** The footnote marker, the brand motif. */
function Cite({ n, className = "" }: { n: ReactNode; className?: string }) {
  return <span className={`cite text-[0.62em] align-super ${className}`}>[{n}]</span>;
}

/** Section label as a citation: "[2] How it works". */
function Eyebrow({ n, children, dark }: { n: number; children: ReactNode; dark?: boolean }) {
  return (
    <p className={`font-mono text-[13px] tracking-wide ${dark ? "text-slate-300" : "text-slate-600"}`}>
      <span className={dark ? "text-brand-300" : "text-brand-700"}>[{n}]</span> {children}
    </p>
  );
}

function H2({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`font-display mt-3 text-[34px] leading-[1.1] font-medium tracking-tight sm:text-[46px] ${className}`}>{children}</h2>;
}

function Check({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function WindowDots({ dark }: { dark?: boolean }) {
  const c = dark ? "bg-slate-700" : "bg-slate-300";
  return (
    <span className="flex gap-1.5" aria-hidden>
      <span className={`size-2.5 rounded-full ${c}`} />
      <span className={`size-2.5 rounded-full ${c}`} />
      <span className={`size-2.5 rounded-full ${c}`} />
    </span>
  );
}

const at = (s: number): CSSProperties => ({ animationDelay: `${s}s` });

/**
 * The hero demo, one orchestrated animation on load (CSS only, no JavaScript): the fact gets marked on the
 * company's page, the opener is written word by word, then its footnote and source appear. With
 * prefers-reduced-motion everything is shown at once (globals.css).
 */
function HeroDemo() {
  const d = HOME.demo;
  const words = d.opener.split(" ");
  const start = 1.6;
  const step = 0.09;
  const done = start + words.length * step;
  return (
    <figure className="relative" aria-label="Example: a fact on the company's website becomes the personal line in your email, with its source">
      {/* The company's website */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_18px_50px_rgb(15_23_42/0.10)] ring-1 ring-slate-200">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5">
          <WindowDots />
          <span className="truncate rounded-md bg-slate-100 px-2.5 py-1 font-mono text-[11px] text-slate-600">{d.url}</span>
        </div>
        <div className="space-y-2 px-5 py-4 text-[13px] leading-relaxed text-slate-600">
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
      {/* The email being written */}
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
          <span className="text-brand-700">[1]</span> {d.factId} · {d.source} · &ldquo;{d.fact.replace(/\.$/, "")}&rdquo;
        </p>
      </div>
    </figure>
  );
}

/** The preview screen of a campaign: leads (a table; stacked cards on a phone) and one written email with its sources. */
function ProductWindow() {
  return (
    <div className="rounded-[28px] bg-white/60 p-2 ring-1 ring-slate-200/80 sm:p-3">
      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgb(15_23_42/0.08)] ring-1 ring-slate-200/80">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <WindowDots />
          <span className="truncate text-xs text-slate-600">Campaigns › Bakeries Utrecht · Preview</span>
        </div>
        <div className="grid lg:grid-cols-[1.45fr_1fr]">
          <div className="min-w-0 p-5 sm:p-6 lg:border-r lg:border-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold">Bakeries Utrecht</p>
                <p className="mt-0.5 text-xs text-slate-600">5 of 240 leads · free preview</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800">4 written</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">1 neutral · 0 credits</span>
              </div>
            </div>
            {/* Phone: stacked cards */}
            <ul className="mt-4 space-y-2 sm:hidden">
              {LEADS.map((l) => (
                <li key={l.name} className="rounded-xl p-3 text-[13px] ring-1 ring-slate-200">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{l.name}</p>
                      <p className="text-xs text-slate-600">
                        {l.company} · {l.site}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-600">{l.facts} facts</span>
                  </div>
                  <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs ${TONE[l.tone]}`}>{l.status}</span>
                </li>
              ))}
            </ul>
            {/* Tablet and up: the table */}
            <div className="mt-5 hidden sm:block">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="text-left text-slate-600">
                    <th className="py-2 font-medium">Lead</th>
                    <th className="py-2 font-medium">Website</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 text-right font-medium">Facts</th>
                  </tr>
                </thead>
                <tbody>
                  {LEADS.map((l) => (
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
            <p className="text-xs text-slate-600">To sanne@bakkerijvos.nl · Subject: Quick question about Utrecht-Oost</p>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-700">
              <p>Hi Sanne,</p>
              <p>
                <mark className="rounded bg-brand-100 px-1 text-brand-950">Saw that Bakkerij Vos just opened a second shop in Utrecht-Oost, congrats.</mark>
                <Cite n={1} className="ml-0.5" />
              </p>
              <p>We help bakeries cut waste with daily order forecasts. Worth a quick call next week?</p>
              <p>Tom</p>
            </div>
            <p className="mt-5 font-mono text-[11px] text-slate-600">Sources on bakkerijvos.nl</p>
            <ul className="mt-2.5 space-y-2 text-[13px]">
              <li className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200">
                <span className="cite text-xs">F1</span> <span className="text-slate-600">&ldquo;Ambachtelijk brood sinds 1987&rdquo;</span> <span className="text-slate-600">· /over-ons</span>
              </li>
              <li className="rounded-xl bg-white px-3 py-2.5 ring-2 ring-brand-500">
                <span className="cite text-xs">[1] F2 · used</span> <span className="text-slate-800">&ldquo;Vanaf 1 maart ook in Utrecht-Oost&rdquo;</span>{" "}
                <span className="text-slate-600">· /nieuws</span>
              </li>
              <li className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-emerald-800 ring-1 ring-slate-200">
                <Check className="size-4" /> Reviewer: specific, supported, not salesy
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepVisual({ i }: { i: number }) {
  const row = (left: string, right: string, cls: string) => (
    <div className="flex justify-between gap-2">
      <span className="truncate">{left}</span>
      <span className={`shrink-0 ${cls}`}>{right}</span>
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
        Hi {"{{first_name}}"},
        <br />
        <span className="tok-slot">[[opener]]</span>
        <br />
        We help bakeries cut waste…
      </p>
    );
  if (i === 2)
    return (
      <div className="space-y-1.5">
        {row("bakkerijvos.nl/", "read", "text-emerald-800")}
        {row("/over-ons", "read", "text-emerald-800")}
        {row("/nieuws", "2 facts", "text-brand-700")}
      </div>
    );
  return (
    <div className="space-y-1.5">
      {row("Gmail · 30 a day", "sending", "text-emerald-800")}
      {row("Follow-up in 3 days", "queued", "text-slate-600")}
      {row("Reply received", "sequence stops", "text-brand-700")}
    </div>
  );
}

export default function Home() {
  const packs = enabledPacks().filter((p) => p.kind === "standard").slice(0, 3);
  const perEmail = (p: (typeof packs)[number]) => Math.round((p.priceCents / p.credits) * 10) / 1000;
  const base = packs.length ? perEmail(packs[0]) : 0;
  const anchor = COMPETITORS.filter((c) => c.inAnchor && c.for300);
  return (
    <div className={`${display.variable} bg-paper min-h-screen text-slate-900`}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-[#fbfaf7]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="FirstLine, home">
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-7 text-sm text-slate-700 md:flex">
            <a href="#how" className="hover:text-slate-950">How it works</a>
            <a href="#pricing" className="hover:text-slate-950">Pricing</a>
            <Link href="/docs/api" className="hover:text-slate-950">{HOME.nav.api}</Link>
            <a href="#faq" className="hover:text-slate-950">FAQ</a>
          </nav>
          <div className="flex items-center gap-3 sm:gap-4">
            <Link href="/login" className="text-sm font-medium text-slate-700 hover:text-slate-950">Sign in</Link>
            <Link href="/signup" className={buttonClass("primary", "rounded-full px-4")}>
              <span className="hidden sm:inline">{HOME.nav.cta}</span>
              <span className="sm:hidden">Try free</span>
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="relative">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-12 sm:px-6 md:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
            <div>
              <h1 className="font-display text-[40px] leading-[1.05] font-medium tracking-tight sm:text-[54px] lg:text-[60px]">
                {HOME.hero.headline}
                <Cite n={1} className="ml-1" />
                <span className="mt-2 block text-slate-600">{HOME.hero.headlineMuted}</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-700">{HOME.hero.sub}</p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link href="/signup" className={buttonClass("accent", "rounded-full px-5 py-3 text-[15px]")}>
                  {HOME.hero.cta} <span aria-hidden>›</span>
                </Link>
                <a href="#pricing" className={buttonClass("secondary", "rounded-full px-5 py-3 text-[15px]")}>{HOME.hero.secondary}</a>
              </div>
              <p className="mt-3 text-sm text-slate-600">{HOME.hero.note}</p>
              <p className="mt-8 border-t border-slate-200 pt-3 font-mono text-[12px] text-slate-600">
                <span className="text-brand-700">[1]</span> {HOME.hero.footnote}
              </p>
            </div>
            <DemoPlayer>
              <HeroDemo />
            </DemoPlayer>
          </div>
          {/* Integrations: names as text (no logo files used) */}
          <div className="border-y border-slate-200/80">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-5 sm:px-6">
              <span className="font-mono text-[12px] text-slate-600">{HOME.integrations.label}</span>
              <ul className="flex flex-wrap gap-x-7 gap-y-2 text-[15px] font-semibold text-slate-700">
                {HOME.integrations.names.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* [1] Problem: an editorial list, not cards */}
        <section className="py-20 md:py-28">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <Eyebrow n={1}>{HOME.problem.eyebrow}</Eyebrow>
              <H2>{HOME.problem.title}</H2>
            </div>
            <ol className="divide-y divide-slate-200 border-y border-slate-200">
              {HOME.problem.items.map((p, i) => (
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

        {/* [2] How it works: four steps with a picture each */}
        <section id="how" className="scroll-mt-20 bg-white py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Eyebrow n={2}>{HOME.how.eyebrow}</Eyebrow>
            <H2>{HOME.how.title}</H2>
            <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl bg-slate-200 ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-4">
              {HOME.how.steps.map((s, i) => (
                <li key={s.title} className="flex flex-col gap-4 bg-white p-6">
                  <span className="flex items-center justify-between gap-2">
                    <span className="cite text-sm">[{i + 1}]</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">{s.time}</span>
                  </span>
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-700">{s.text}</p>
                  <div className="mt-auto rounded-xl bg-[#fbfaf7] p-3 text-xs leading-relaxed text-slate-700 ring-1 ring-slate-200">
                    <StepVisual i={i} />
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* [3] Trust: the claim, then the screen that proves it */}
        <section id="proof" className="scroll-mt-20 py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-start">
              <div>
                <Eyebrow n={3}>{HOME.trust.eyebrow}</Eyebrow>
                <H2>
                  {HOME.trust.title}
                  <Cite n={1} className="ml-1" />
                </H2>
              </div>
              <div className="lg:pt-9">
                <p className="leading-relaxed text-slate-700">{HOME.trust.body}</p>
                <ul className="mt-5 space-y-2.5 text-[15px]">
                  {HOME.trust.points.map((t) => (
                    <li key={t} className="flex items-center gap-3">
                      <span className="grid size-6 place-items-center rounded-md bg-slate-950 text-white">
                        <Check />
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-12">
              <ProductWindow />
              <p className="mt-3 font-mono text-[12px] text-slate-600">
                <span className="text-brand-700">[1]</span> {HOME.preview.title}. {HOME.preview.text}
              </p>
            </div>
          </div>
        </section>

        {/* [4] API (dark) */}
        <section id="api" className="bg-grid-dark scroll-mt-16 bg-slate-950 py-20 text-white md:py-28">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.25fr]">
            <div>
              <Eyebrow n={4} dark>
                {HOME.api.eyebrow}
              </Eyebrow>
              <H2>{HOME.api.title}</H2>
              <p className="mt-4 max-w-md text-[17px] leading-relaxed text-slate-300">{HOME.api.body}</p>
              <Link href="/docs/api" className="mt-6 inline-flex rounded-full px-[18px] py-2.5 text-sm font-medium text-white ring-1 ring-white/30 hover:bg-white/5">
                {HOME.api.cta} <span aria-hidden className="ml-1">›</span>
              </Link>
            </div>
            <div className="min-w-0 overflow-hidden rounded-2xl bg-[#0b1220] ring-1 ring-white/10">
              <div className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3 text-xs text-slate-400">
                <WindowDots dark />
                <span>POST /api/v1/personalize</span>
              </div>
              <pre className="max-w-full overflow-x-auto p-5 font-mono text-[12.5px] leading-[1.7] text-slate-300" tabIndex={0} aria-label="Example API request and response">
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
                <span className="text-brand-300">{`"Saw that Bakkerij Vos just opened
      a second shop in Utrecht-Oost, congrats."`}</span>
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

        {/* [5] Pricing: the price per email is the big number */}
        <section id="pricing" className="scroll-mt-20 py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end">
              <div>
                <Eyebrow n={5}>{HOME.pricing.eyebrow}</Eyebrow>
                <H2>{HOME.pricing.title}</H2>
                <p className="mt-3 text-[17px] text-slate-700">{HOME.pricing.sub}</p>
              </div>
              <p className="text-[17px] text-slate-900">
                <strong className="font-semibold">{HOME.pricing.anchor}</strong> <span className="text-slate-600">{HOME.pricing.anchorNote}</span>
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
                      {featured && <span className="rounded-full bg-brand-700 px-2.5 py-0.5 text-xs font-medium text-white">{HOME.pricing.mostPopular}</span>}
                      {!featured && save >= 10 && <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">{HOME.pricing.save(save)}</span>}
                    </div>
                    <p className="mt-6 font-display text-[52px] leading-none font-medium tracking-tight">€{pe.toFixed(3)}</p>
                    <p className={`mt-1 text-sm ${featured ? "text-slate-300" : "text-slate-600"}`}>{HOME.pricing.perEmail}</p>
                    <p className={`mt-6 border-t pt-4 text-sm ${featured ? "border-white/15 text-slate-200" : "border-slate-100 text-slate-700"}`}>
                      {HOME.pricing.packLine(p.credits.toLocaleString("en-US"), euro(p.priceCents))} · {HOME.pricing.perPack}
                    </p>
                    <Link href="/signup" className={buttonClass(featured ? "accent" : "secondary", "mt-6 w-full rounded-full py-2.5")}>
                      {HOME.pricing.buy(p.credits.toLocaleString("en-US"))}
                    </Link>
                  </div>
                );
              })}
            </div>

            {/* Competitor anchor: numbers and sources from src/content/competitors.ts */}
            <div className="mt-8 rounded-2xl bg-white p-6 ring-1 ring-slate-200">
              <p className="text-[17px]">
                <span className="text-slate-700">{HOME.pricing.compare.elsewhere}</span> <strong className="font-semibold">{HOME.pricing.compare.us}</strong>
              </p>
              <details className="group mt-3 text-sm text-slate-600">
                <summary className="cursor-pointer list-none font-mono text-[12px] text-slate-700 [&::-webkit-details-marker]:hidden">
                  <span className="text-brand-700">[†]</span> {HOME.pricing.compare.sourcesLabel} <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span>
                </summary>
                <p className="mt-3">{HOME.pricing.compare.sourcesNote}</p>
                <ul className="mt-3 space-y-1.5">
                  {anchor.map((c) => (
                    <li key={c.id}>
                      <a href={c.source} className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900" rel="noopener nofollow" target="_blank">
                        {c.name}
                      </a>
                      : {c.for300!.plan}, {c.for300!.currency}
                      {c.for300!.price}/month. <span className="text-slate-500">{c.notes}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-slate-500">Checked on {checkedOnLabel()}. Prices change; follow the links for the current ones.</p>
              </details>
            </div>
            <p className="mt-6 text-sm text-slate-600">{HOME.pricing.footnote}</p>
          </div>
        </section>

        {/* [6] FAQ */}
        <section id="faq" className="scroll-mt-20 bg-white py-20 md:py-28">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 md:grid-cols-[1fr_2fr]">
            <div>
              <Eyebrow n={6}>{HOME.faq.eyebrow}</Eyebrow>
              <H2>{HOME.faq.title}</H2>
            </div>
            <div className="divide-y divide-slate-200 border-y border-slate-200">
              {HOME.faq.items.map((f) => (
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
            <h2 className="font-display text-[34px] leading-tight font-medium tracking-tight sm:text-[46px]">{HOME.finalCta.title}</h2>
            <p className="mt-3 text-[17px] text-slate-300">{HOME.finalCta.sub}</p>
            <Link href="/signup" className={buttonClass("accent", "mt-8 rounded-full px-6 py-3 text-[15px]")}>
              {HOME.finalCta.cta} <span aria-hidden>›</span>
            </Link>
          </div>
          <div className="mx-auto mt-10 max-w-2xl space-y-2 text-center text-[15px] text-slate-700">
            <p>{HOME.honestLine}</p>
            <p className="text-slate-600">{HOME.founderNote}</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <Logo />
            <span>© 2026</span>
          </div>
          <nav aria-label="Legal" className="flex flex-wrap gap-5">
            <Link href="/privacy" className="hover:text-slate-950">{HOME.footer.privacy}</Link>
            <Link href="/terms" className="hover:text-slate-950">{HOME.footer.terms}</Link>
            <Link href="/dpa" className="hover:text-slate-950">{HOME.footer.dpa}</Link>
            <Link href="/subprocessors" className="hover:text-slate-950">{HOME.footer.subprocessors}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
