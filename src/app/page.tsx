import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { HOME } from "@/content/home";
import { buttonClass, Logo } from "@/components/ui";
import { enabledPacks, euro } from "@/lib/credits";

// Example data for the product visuals (a made-up bakery campaign). Every visual mirrors a real screen.
const LEADS = [
  { name: "Sanne de Vos", company: "Bakkerij Vos", site: "bakkerijvos.nl", status: "Written · high", tone: "brand", facts: "4" },
  { name: "Joris Bakker", company: "Het Zuurdesemhuis", site: "zuurdesemhuis.nl", status: "Written · high", tone: "brand", facts: "6" },
  { name: "Lotte Peters", company: "Broodhuys Oost", site: "broodhuys.nl", status: "Writing…", tone: "blue", facts: "3" },
  { name: "Mark Smit", company: "De Korenaar", site: "dekorenaar.nl", status: "Reading website…", tone: "blue", facts: "–" },
  { name: "Eva Jansen", company: "Bakkerij Jansen", site: "bakkerijjansen.nl", status: "Neutral line · free", tone: "gray", facts: "0" },
] as const;

const TONE = { brand: "bg-brand-50 text-brand-700", blue: "bg-blue-50 text-blue-700", gray: "bg-slate-100 text-slate-700" } as const;

const TOOLS = ["Gmail", "Instantly", "Smartlead", "Lemlist", "n8n", "Make", "CSV"];

const LEDGER = [
  { label: "Growth pack", value: "+2,000", cls: "font-medium text-emerald-700" },
  { label: "Sanne de Vos · written", value: "−1", cls: "text-slate-700" },
  { label: "Joris Bakker · written", value: "−1", cls: "text-slate-700" },
  { label: "Eva Jansen · no facts found", value: "0", cls: "text-slate-500" },
  { label: "Two more leads written", value: "−2", cls: "text-slate-700" },
];

export const metadata: Metadata = {
  title: { absolute: HOME.meta.title },
  description: HOME.meta.description,
  openGraph: { title: HOME.meta.ogTitle, description: HOME.meta.ogDescription, type: "website", siteName: "FirstLine" },
  twitter: { card: "summary_large_image", title: HOME.meta.ogTitle, description: HOME.meta.ogDescription },
};

function Eyebrow({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return <p className={`text-xs font-semibold tracking-[0.14em] uppercase ${dark ? "text-brand-400" : "text-brand-600"}`}>{children}</p>;
}

function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-3 text-3xl leading-tight font-semibold tracking-tight sm:text-[44px]">{children}</h2>;
}

function Check({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function WindowDots({ dark }: { dark?: boolean }) {
  const c = dark ? "bg-slate-800" : "bg-slate-200";
  return (
    <>
      <span className={`size-2.5 rounded-full ${c}`} />
      <span className={`size-2.5 rounded-full ${c}`} />
      <span className={`size-2.5 rounded-full ${c}`} />
    </>
  );
}

/** The preview screen of a campaign: leads on the left, one written email with its sources on the right. */
function ProductWindow() {
  return (
    <div className="rounded-[28px] bg-slate-50 p-2 ring-1 ring-slate-200/80 sm:p-3">
      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgb(15_23_42/0.10)] ring-1 ring-slate-200/80">
        <div className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-3">
          <WindowDots />
          <span className="ml-3 truncate text-xs text-slate-500">Campaigns › Bakeries Utrecht · Preview</span>
        </div>
        <div className="grid lg:grid-cols-[1.45fr_1fr]">
          <div className="min-w-0 p-5 sm:p-6 lg:border-r lg:border-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold">Bakeries Utrecht</p>
                <p className="mt-0.5 text-xs text-slate-500">5 of 240 leads · free preview</p>
              </div>
              <div className="flex gap-2 text-xs">
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">4 written</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">1 neutral · 0 credits</span>
              </div>
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[460px] border-collapse text-[13px]">
                <thead>
                  <tr className="text-left text-slate-500">
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
                        <p className="text-xs text-slate-500">{l.company}</p>
                      </td>
                      <td className="py-3 text-slate-600">{l.site}</td>
                      <td className="py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs ${TONE[l.tone]}`}>{l.status}</span>
                      </td>
                      <td className={`py-3 text-right ${l.facts === "–" ? "text-slate-400" : "text-slate-600"}`}>{l.facts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="min-w-0 border-t border-slate-100 bg-slate-50/50 p-5 sm:p-6 lg:border-t-0">
            <p className="text-xs text-slate-500">To sanne@bakkerijvos.nl · Subject: Quick question about Utrecht-Oost</p>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-700">
              <p>Hi Sanne,</p>
              <p>
                <mark className="rounded bg-brand-100 px-1 text-brand-950">Saw that Bakkerij Vos just opened a second shop in Utrecht-Oost, congrats.</mark>
                <sup className="ml-0.5 text-[10px] font-semibold text-brand-600">F2</sup>
              </p>
              <p>We help bakeries cut waste with daily order forecasts. Worth a quick call next week?</p>
              <p>Tom</p>
            </div>
            <p className="mt-5 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Sources on bakkerijvos.nl</p>
            <ul className="mt-2.5 space-y-2 text-[13px]">
              <li className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200">
                <span className="font-semibold text-slate-500">F1</span> <span className="text-slate-600">&ldquo;Ambachtelijk brood sinds 1987&rdquo;</span>{" "}
                <span className="text-slate-400">· /over-ons</span>
              </li>
              <li className="rounded-xl bg-white px-3 py-2.5 ring-2 ring-brand-500">
                <span className="font-semibold text-brand-600">F2 · used</span> <span className="text-slate-700">&ldquo;Vanaf 1 maart ook in Utrecht-Oost&rdquo;</span>{" "}
                <span className="text-slate-400">· /nieuws</span>
              </li>
              <li className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-emerald-700 ring-1 ring-slate-200">
                <Check className="size-4" /> Reviewer: specific, supported, not salesy
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepCard({ n, time, title, text, children }: { n: string; time: string; title: string; text: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-4 rounded-2xl bg-white p-6 ring-1 ring-slate-200/80">
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm text-brand-600">{n}</span>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">{time}</span>
      </span>
      <div className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 ring-1 ring-slate-100">{children}</div>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{text}</p>
      </div>
    </li>
  );
}

function Row({ left, right, cls }: { left: string; right: string; cls: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="truncate">{left}</span>
      <span className={`shrink-0 ${cls}`}>{right}</span>
    </div>
  );
}

export default function Home() {
  const packs = enabledPacks().filter((p) => p.kind === "standard").slice(0, 3);
  const perEmail = (p: (typeof packs)[number]) => euro(Math.round((p.priceCents / p.credits) * 10) / 10);
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="FirstLine home">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-slate-600 md:flex">
            <a href="#how" className="hover:text-slate-950">How it works</a>
            <a href="#proof" className="hover:text-slate-950">Sources</a>
            <a href="#api" className="hover:text-slate-950">{HOME.nav.api}</a>
            <a href="#pricing" className="hover:text-slate-950">Pricing</a>
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

      <main>
        {/* Hero + product */}
        <section className="bg-grid relative">
          <div className="mx-auto max-w-6xl px-4 pt-16 sm:px-6 md:pt-24">
            <div className="flex flex-wrap items-end justify-between gap-10">
              <h1 className="min-w-0 flex-[999_1_520px] text-[2.2rem] leading-[1.06] font-semibold tracking-tight sm:text-5xl lg:text-[60px]">
                {HOME.hero.headline}
                <span className="block text-slate-400">{HOME.hero.headlineMuted}</span>
              </h1>
              <div className="max-w-sm flex-[1_1_320px] pb-2">
                <p className="text-lg leading-relaxed text-slate-600">{HOME.hero.sub}</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/signup" className={buttonClass("accent", "rounded-full px-5 py-2.5 text-[15px]")}>
                    {HOME.hero.cta} <span aria-hidden>›</span>
                  </Link>
                  <a href="#pricing" className={buttonClass("secondary", "rounded-full px-5 py-2.5 text-[15px]")}>{HOME.hero.secondary}</a>
                </div>
                <p className="mt-3 text-sm text-slate-500">{HOME.hero.note}</p>
              </div>
            </div>
            <div className="mt-14 md:mt-16">
              <ProductWindow />
            </div>
          </div>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-9 gap-y-3 px-4 pt-12 pb-16 text-[15px] font-semibold text-slate-400 sm:px-6">
            <span className="text-[13px] font-medium text-slate-500">Send or export to</span>
            {TOOLS.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        </section>

        {/* Problem */}
        <section className="py-20 md:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Eyebrow>{HOME.problem.eyebrow}</Eyebrow>
            <H2>{HOME.problem.title}</H2>
            <div className="mt-10 grid gap-8 md:grid-cols-3">
              {HOME.problem.items.map((p, i) => (
                <div key={p.title} className="border-t border-slate-200 pt-5">
                  <span className="font-mono text-sm text-slate-400">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="mt-2 font-semibold">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{p.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-20 border-y border-slate-100 bg-slate-50/70 py-20 md:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Eyebrow>{HOME.how.eyebrow}</Eyebrow>
            <H2>{HOME.how.title}</H2>
            <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StepCard n="01" time={HOME.how.steps[0].time} title={HOME.how.steps[0].title} text={HOME.how.steps[0].text}>
                <p className="font-mono text-[11px] leading-[1.75] text-slate-600">
                  email,first_name,website
                  <br />
                  sanne@bakkerijvos.nl,Sanne,bakkerijvos.nl
                  <br />
                  joris@zuurdesem…,Joris,zuurdesem…
                </p>
              </StepCard>
              <StepCard n="02" time={HOME.how.steps[1].time} title={HOME.how.steps[1].title} text={HOME.how.steps[1].text}>
                Hi {"{{first_name}}"},
                <br />
                <span className="tok-slot">[[opener]]</span>
                <br />
                We help bakeries cut waste…
              </StepCard>
              <StepCard n="03" time={HOME.how.steps[2].time} title={HOME.how.steps[2].title} text={HOME.how.steps[2].text}>
                <div className="space-y-1.5">
                  <Row left="bakkerijvos.nl/" right="read" cls="text-emerald-700" />
                  <Row left="/over-ons" right="read" cls="text-emerald-700" />
                  <Row left="/nieuws" right="2 facts" cls="text-brand-600" />
                </div>
              </StepCard>
              <StepCard n="04" time={HOME.how.steps[3].time} title={HOME.how.steps[3].title} text={HOME.how.steps[3].text}>
                <div className="space-y-1.5">
                  <Row left="Gmail · 30 a day" right="sending" cls="text-emerald-700" />
                  <Row left="Follow-up in 3 days" right="queued" cls="text-slate-500" />
                  <Row left="Reply received" right="sequence stops" cls="text-brand-600" />
                </div>
              </StepCard>
            </ol>
          </div>
        </section>

        {/* Trust + credits */}
        <section id="proof" className="scroll-mt-20 py-20 md:py-24">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <Eyebrow>{HOME.trust.eyebrow}</Eyebrow>
              <H2>{HOME.trust.title}</H2>
              <p className="mt-4 max-w-lg text-[17px] leading-relaxed text-slate-600">{HOME.trust.body}</p>
              <ul className="mt-7 space-y-3.5 text-[15px]">
                {HOME.trust.points.map((t) => (
                  <li key={t} className="flex items-center gap-3">
                    <span className="grid size-7 place-items-center rounded-lg bg-slate-950 text-white">
                      <Check />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-3xl bg-white p-6 shadow-[0_16px_48px_rgb(15_23_42/0.08)] ring-1 ring-slate-200/80 sm:p-7">
              <div className="flex items-baseline justify-between">
                <p className="font-semibold">Credits</p>
                <p className="text-xs text-slate-500">1 credit = 1 written email</p>
              </div>
              <p className="mt-4 text-[44px] leading-none font-semibold tracking-tight tabular-nums">1,996</p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full w-[92%] rounded-full bg-brand-600" />
              </div>
              <div className="mt-5 divide-y divide-slate-100 text-sm">
                {LEDGER.map((r) => (
                  <div key={r.label} className="flex justify-between gap-3 py-3">
                    <span>{r.label}</span>
                    <span className={`tabular-nums ${r.cls}`}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* API (dark) */}
        <section id="api" className="bg-grid-dark scroll-mt-16 bg-slate-950 py-20 text-white md:py-24">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.25fr]">
            <div>
              <Eyebrow dark>{HOME.api.eyebrow}</Eyebrow>
              <H2>{HOME.api.title}</H2>
              <p className="mt-4 max-w-md text-[17px] leading-relaxed text-slate-400">{HOME.api.body}</p>
              <Link href="/docs/api" className="mt-6 inline-flex rounded-full px-[18px] py-2.5 text-sm font-medium text-white ring-1 ring-white/20 hover:bg-white/5">
                {HOME.api.cta} <span aria-hidden className="ml-1">›</span>
              </Link>
            </div>
            <div className="min-w-0 overflow-hidden rounded-2xl bg-[#0b1220] ring-1 ring-white/10">
              <div className="flex items-center gap-1.5 border-b border-white/[0.08] px-4 py-3 text-xs text-slate-500">
                <WindowDots dark />
                <span className="ml-2.5">POST /api/v1/personalize</span>
              </div>
              <pre className="overflow-x-auto p-5 font-mono text-[12.5px] leading-[1.7] text-slate-300">
                {`curl -X POST $FIRSTLINE/api/v1/personalize \\
  -H "Authorization: Bearer $FIRSTLINE_KEY" \\
  -d '{"lead": {"email": "sanne@bakkerijvos.nl",
              "website": "bakkerijvos.nl"},
       "campaign_id": "…", "wait": 60}'

`}
                <span className="text-slate-500">{"// 200 OK"}</span>
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

        {/* Pricing */}
        <section id="pricing" className="scroll-mt-20 py-20 md:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Eyebrow>{HOME.pricing.eyebrow}</Eyebrow>
            <H2>{HOME.pricing.title}</H2>
            <p className="mt-3 text-[17px] text-slate-600">{HOME.pricing.sub}</p>
            <p className="mt-2 text-[17px] text-slate-900">
              <strong className="font-semibold">{HOME.pricing.anchor}</strong> <span className="text-slate-500">{HOME.pricing.anchorNote}</span>
            </p>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {packs.map((p) => {
                const featured = p.id === "growth";
                return (
                  <div key={p.id} className={`flex flex-col rounded-3xl p-7 ${featured ? "bg-slate-950 text-white shadow-[0_24px_60px_rgb(15_23_42/0.25)]" : "ring-1 ring-slate-200/80"}`}>
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">{p.name}</h3>
                      {featured && <span className="rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-medium">{HOME.pricing.mostPopular}</span>}
                    </div>
                    <p className="mt-6 text-[44px] leading-none font-semibold tracking-tight">{euro(p.priceCents)}</p>
                    <p className={`mt-2 text-sm ${featured ? "text-slate-400" : "text-slate-500"}`}>{HOME.pricing.perPack}</p>
                    <p className={`mt-6 border-t pt-4 text-sm ${featured ? "border-white/10 text-slate-300" : "border-slate-100 text-slate-700"}`}>
                      {p.credits.toLocaleString("en-US")} emails · {perEmail(p)} each
                    </p>
                    <Link href="/signup" className={buttonClass(featured ? "accent" : "secondary", "mt-6 w-full rounded-full py-2.5")}>
                      {HOME.pricing.buy(p.credits.toLocaleString("en-US"))}
                    </Link>
                  </div>
                );
              })}
            </div>
            <p className="mt-6 text-sm text-slate-500">{HOME.pricing.footnote}</p>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 border-t border-slate-100 bg-slate-50/70 py-20 md:py-24">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 md:grid-cols-[1fr_2fr]">
            <div>
              <Eyebrow>{HOME.faq.eyebrow}</Eyebrow>
              <H2>{HOME.faq.title}</H2>
            </div>
            <div className="divide-y divide-slate-200 rounded-2xl bg-white ring-1 ring-slate-200/80">
              {HOME.faq.items.map((f) => (
                <details key={f.q} className="group px-6 py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span className="text-xl leading-none text-slate-400 transition-transform group-open:rotate-45" aria-hidden>
                      +
                    </span>
                  </summary>
                  <p className="mt-3 leading-relaxed text-slate-600">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="px-4 py-20 sm:px-6 md:py-24">
          <div className="bg-grid-dark mx-auto max-w-6xl rounded-[32px] bg-slate-950 px-6 py-16 text-center text-white sm:px-12 md:py-[72px]">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-[44px]">{HOME.finalCta.title}</h2>
            <p className="mt-3 text-[17px] text-slate-400">{HOME.finalCta.sub}</p>
            <Link href="/signup" className={buttonClass("accent", "mt-8 rounded-full px-6 py-3 text-[15px]")}>
              {HOME.finalCta.cta} <span aria-hidden>›</span>
            </Link>
          </div>
          <div className="mx-auto mt-10 max-w-2xl space-y-2 text-center text-[15px] text-slate-600">
            <p>{HOME.honestLine}</p>
            <p className="text-slate-500">{HOME.founderNote}</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200/70">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <Logo />
            <span>© 2026</span>
          </div>
          <nav className="flex flex-wrap gap-5">
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
