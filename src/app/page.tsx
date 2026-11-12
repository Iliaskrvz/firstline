import Link from "next/link";
import { buttonClass, Logo } from "@/components/ui";
import { enabledPacks, euro } from "@/lib/credits";

const STEPS = [
  { title: "Upload your leads", text: "A CSV with names, companies and websites. We clean domains and remove duplicates." },
  { title: "Paste your own email", text: "Mark the few spots to personalise, like [[opener]]. Everything else stays word for word." },
  { title: "We read each website", text: "FirstLine finds real facts on the company's own site and writes only your slots, citing every claim." },
  { title: "Send or export", text: "Send from your own Gmail with safe daily limits and follow-ups, or push to your sending tool." },
];

const PROMISES = [
  { icon: "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z", title: "Every claim is cited", text: "Each personal line links to the fact and page it came from. No invented details." },
  { icon: "M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33", title: "No facts, no charge", text: "If a website has nothing useful, the lead gets a neutral line and costs 0 credits." },
  { icon: "M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z", title: "Your copy stays yours", text: "The AI only fills the slots you marked. Your offer and tone are never rewritten." },
  { icon: "M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z", title: "Checked before you see it", text: "Code checks plus an AI reviewer catch generic, salesy or unsupported lines, and rewrite them." },
];

const TOOLS = ["Gmail", "Instantly", "Smartlead", "Lemlist", "CSV", "n8n", "Make", "REST API"];

const FAQ = [
  { q: "Do I need a subscription?", a: "No. Buy credits when you need them; they never expire. 1 credit = 1 personalised email." },
  { q: "Can I try it first?", a: "Yes. You get 25 free credits after confirming your email, and every campaign starts with a free preview of 5 leads." },
  { q: "How does sending from Gmail work?", a: "You copy a Google Sheet with a small script into your own Google account. It sends from your inbox at a safe pace and stops a sequence when someone replies. We never get your password." },
  { q: "Does FirstLine scrape LinkedIn?", a: "No. Research uses only the company's public website. Names and job titles come from your own list." },
  { q: "Which languages?", a: "English and Dutch, picked automatically from the language of your email." },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function Eyebrow({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${dark ? "text-brand-400" : "text-brand-600"}`}>{children}</p>;
}

export default function Home() {
  const packs = enabledPacks().filter((p) => p.kind === "standard").slice(0, 3);
  const perEmail = (p: (typeof packs)[number]) => euro(Math.round((p.priceCents / p.credits) * 10) / 10);
  const cheapest = packs.length ? perEmail(packs[packs.length - 1]) : null;
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="FirstLine home">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-slate-600 md:flex">
            <a href="#how" className="hover:text-slate-950">How it works</a>
            <a href="#pricing" className="hover:text-slate-950">Pricing</a>
            <Link href="/docs/api" className="hover:text-slate-950">API</Link>
            <a href="#faq" className="hover:text-slate-950">FAQ</a>
          </nav>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link href="/login" className="text-sm font-medium text-slate-700 hover:text-slate-950">Sign in</Link>
            <Link href="/signup" className={buttonClass("primary", "rounded-full px-4")}>Get started</Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="bg-grid bg-grid-fade pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-12 sm:px-6 md:pt-24">
            <div className="grid gap-10 md:grid-cols-[1.35fr_1fr] md:items-end">
              <h1 className="text-[2.6rem] leading-[1.05] font-semibold tracking-tight sm:text-6xl md:text-5xl lg:text-7xl">
                Researched first lines
                <span className="block text-slate-400">for your cold email</span>
              </h1>
              <div className="md:pb-2">
                <p className="text-lg leading-relaxed text-slate-600">
                  Keep your own copy.
                  <br />
                  We write only the personal lines.
                  <br />
                  Every claim comes with a source.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/signup" className={buttonClass("accent", "rounded-full px-5 py-2.5 text-[15px]")}>
                    Get 25 free credits <span aria-hidden>›</span>
                  </Link>
                  <a href="#pricing" className={buttonClass("secondary", "rounded-full px-5 py-2.5 text-[15px]")}>See pricing</a>
                </div>
              </div>
            </div>

            {/* Ticket strip */}
            <div className="mx-auto mt-14 grid max-w-3xl overflow-hidden rounded-2xl bg-white shadow-[0_8px_30px_rgb(15_23_42/0.08)] ring-1 ring-slate-200/80 sm:grid-cols-2">
              <div className="p-5 sm:p-6">
                <p className="text-3xl font-semibold tracking-tight">
                  <span className="text-brand-600">{cheapest ?? "Pay"}</span> <span className="text-xl text-slate-900">per email</span>
                </p>
                <p className="mt-1 text-sm text-slate-500">Prepaid credits that never expire. No subscription.</p>
              </div>
              <div className="flex items-center gap-4 border-t border-dashed border-slate-200 p-5 sm:border-t-0 sm:border-l sm:p-6">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                  <Icon d="M21 11.25v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 1 0 9.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1 1 14.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
                </span>
                <p className="text-sm text-slate-600">25 free credits after you confirm your email, and a free 5-lead preview on every campaign.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Product shot */}
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="rounded-3xl bg-slate-50 p-2 ring-1 ring-slate-200/80 sm:p-3">
            <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/80">
              <div className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-3">
                <span className="size-2.5 rounded-full bg-slate-200" />
                <span className="size-2.5 rounded-full bg-slate-200" />
                <span className="size-2.5 rounded-full bg-slate-200" />
                <span className="ml-3 text-xs text-slate-400">Preview · lead 2 of 5</span>
              </div>
              <div className="grid md:grid-cols-[1.4fr_1fr]">
                <div className="p-6 text-[15px] leading-relaxed text-slate-700 sm:p-8">
                  <p className="text-xs text-slate-400">To: sanne@bakkerijvos.nl · Subject: Quick question about Utrecht-Oost</p>
                  <p className="mt-5">Hi Sanne,</p>
                  <p className="mt-3">
                    <mark className="rounded bg-brand-100 px-1 text-brand-950">Saw that Bakkerij Vos just opened a second shop in Utrecht-Oost, congrats.</mark>
                    <sup className="ml-0.5 text-[10px] font-semibold text-brand-600">[F2]</sup>
                  </p>
                  <p className="mt-3">We help bakeries cut waste with daily order forecasts. Worth a quick call next week?</p>
                  <p className="mt-3">Tom</p>
                </div>
                <div className="border-t border-slate-100 bg-slate-50/60 p-6 text-sm sm:p-8 md:border-t-0 md:border-l">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Facts found on bakkerijvos.nl</p>
                  <ul className="mt-4 space-y-3">
                    <li className="rounded-xl bg-white p-3 ring-1 ring-slate-200/80">
                      <span className="text-xs font-semibold text-slate-500">F1</span>
                      <p className="mt-1 text-slate-600">&ldquo;Ambachtelijk brood sinds 1987&rdquo;</p>
                      <p className="mt-1 text-xs text-slate-400">/over-ons</p>
                    </li>
                    <li className="rounded-xl bg-white p-3 ring-2 ring-brand-500/60">
                      <span className="text-xs font-semibold text-brand-600">F2 · used</span>
                      <p className="mt-1 text-slate-700">&ldquo;Vanaf 1 maart ook in Utrecht-Oost&rdquo;</p>
                      <p className="mt-1 text-xs text-slate-400">/nieuws</p>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-20 border-t border-slate-100 bg-slate-50/60 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <Eyebrow>How it works</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Your email. Their website. One good line.</h2>
            </div>
            <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="rounded-2xl bg-white p-6 ring-1 ring-slate-200/80">
                  <span className="font-mono text-sm text-brand-600">0{i + 1}</span>
                  <h3 className="mt-4 font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Promises */}
        <section className="py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <Eyebrow>Built to be trusted</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Personal, never made up</h2>
            </div>
            <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {PROMISES.map((p) => (
                <div key={p.title} className="flex gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-950 text-white">
                    <Icon d={p.icon} />
                  </span>
                  <div>
                    <h3 className="font-semibold">{p.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-slate-600">{p.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Send anywhere (dark) */}
        <section className="relative overflow-hidden bg-slate-950 py-20 text-white">
          <div className="bg-grid-dark pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 md:grid-cols-2 md:items-center">
            <div>
              <Eyebrow dark>Send or export</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Works with the tools you already use</h2>
              <p className="mt-4 max-w-md leading-relaxed text-slate-400">
                Send from your own Gmail at a safe pace with follow-ups, push finished emails into your sending tool, or connect FirstLine to your own workflow with the API.
              </p>
            </div>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {TOOLS.map((t) => (
                <li key={t} className="rounded-xl bg-white/5 px-4 py-3 text-center text-sm font-medium text-slate-200 ring-1 ring-white/10">
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="scroll-mt-20 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <Eyebrow>Pricing</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Pay per email. Nothing else.</h2>
              <p className="mt-3 text-slate-600">1 credit = 1 personalised email. Credits never expire. Sending from Gmail and plain follow-ups are free.</p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {packs.map((p) => {
                const featured = p.id === "growth";
                return (
                  <div key={p.id} className={`relative rounded-2xl p-6 ${featured ? "bg-slate-950 text-white shadow-xl" : "bg-white ring-1 ring-slate-200/80"}`}>
                    {featured && <span className="absolute top-6 right-6 rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-medium text-white">Most popular</span>}
                    <h3 className="font-semibold">{p.name}</h3>
                    <p className="mt-6 text-4xl font-semibold tracking-tight">{euro(p.priceCents)}</p>
                    <p className={`mt-1 text-sm ${featured ? "text-slate-400" : "text-slate-500"}`}>excl. VAT · one-time</p>
                    <p className={`mt-6 border-t pt-4 text-sm ${featured ? "border-white/10 text-slate-300" : "border-slate-100 text-slate-700"}`}>
                      {p.credits.toLocaleString("en-US")} emails · {perEmail(p)} each
                    </p>
                    <Link href="/signup" className={buttonClass(featured ? "accent" : "secondary", "mt-6 w-full rounded-full")}>
                      Start free
                    </Link>
                  </div>
                );
              })}
            </div>
            <p className="mt-6 text-sm text-slate-500">Only leads that get a finished email use a credit. Economy mode (results within hours) and extra research options are available inside the app.</p>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 border-t border-slate-100 bg-slate-50/60 py-20">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 md:grid-cols-[1fr_2fr]">
            <div>
              <Eyebrow>FAQ</Eyebrow>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Questions</h2>
            </div>
            <div className="divide-y divide-slate-200 rounded-2xl bg-white ring-1 ring-slate-200/80">
              {FAQ.map((f) => (
                <details key={f.q} className="group px-6 py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span className="text-xl leading-none text-slate-400 transition-transform group-open:rotate-45" aria-hidden>+</span>
                  </summary>
                  <p className="mt-3 leading-relaxed text-slate-600">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="px-4 py-20 sm:px-6">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-slate-950 px-6 py-16 text-center text-white sm:px-12">
            <div className="bg-grid-dark pointer-events-none absolute inset-0" aria-hidden />
            <div className="relative">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Try it on your own leads</h2>
              <p className="mt-3 text-slate-400">25 free credits after you confirm your email. No card needed.</p>
              <Link href="/signup" className={buttonClass("accent", "mt-8 rounded-full px-6 py-2.5 text-[15px]")}>
                Get started <span aria-hidden>›</span>
              </Link>
            </div>
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
            <Link href="/privacy" className="hover:text-slate-950">Privacy</Link>
            <Link href="/terms" className="hover:text-slate-950">Terms</Link>
            <Link href="/dpa" className="hover:text-slate-950">DPA</Link>
            <Link href="/subprocessors" className="hover:text-slate-950">Sub-processors</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
