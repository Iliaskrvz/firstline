import Link from "next/link";
import { buttonClass, Logo } from "@/components/ui";
import { enabledPacks, euro } from "@/lib/credits";

const STEPS = [
  { title: "Upload your leads", text: "A CSV with names, companies and websites. We clean domains and remove duplicates." },
  { title: "Paste your own email", text: "Mark the few spots to personalise, like [[opener]]. Everything else stays word for word." },
  { title: "We read each website", text: "FirstLine finds real facts on the company's own site and writes only your slots, citing every claim." },
  { title: "Send or export", text: "Send from your own Gmail with safe daily limits and follow-ups, or export a CSV for Instantly, Smartlead or Lemlist." },
];

const PROMISES = [
  { title: "Every claim is cited", text: "Each personal line links to the fact and page it came from. No invented details." },
  { title: "No facts, no charge", text: "If a website has nothing useful, the lead gets a neutral line and costs 0 credits." },
  { title: "Your copy stays yours", text: "The AI only fills the slots you marked. Your offer and tone are never rewritten." },
  { title: "Checked before you see it", text: "Code checks plus an AI reviewer catch generic, salesy or unsupported lines, and rewrite them." },
];

const FAQ = [
  { q: "Do I need a subscription?", a: "No. Buy credits when you need them; they never expire. 1 credit = 1 personalised email." },
  { q: "Can I try it first?", a: "Yes. You get 25 free credits after confirming your email, and every campaign starts with a free preview of 5 leads." },
  { q: "How does sending from Gmail work?", a: "You copy a Google Sheet with a small script into your own Google account. It sends from your inbox at a safe pace and stops a sequence when someone replies. We never get your password." },
  { q: "Does FirstLine scrape LinkedIn?", a: "No. Research uses only the company's public website. Names and job titles come from your own list." },
  { q: "Which languages?", a: "English and Dutch, picked automatically from the language of your email." },
];

export default function Home() {
  const packs = enabledPacks().filter((p) => p.kind === "standard").slice(0, 3);
  const perEmail = (p: (typeof packs)[number]) => euro(Math.round((p.priceCents / p.credits) * 10) / 10);
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-5xl px-6">
        <header className="flex items-center justify-between py-6">
          <Logo />
          <nav className="flex items-center gap-5 text-sm text-slate-600">
            <a href="#pricing" className="hidden hover:text-slate-900 sm:inline">Pricing</a>
            <a href="#faq" className="hidden hover:text-slate-900 sm:inline">FAQ</a>
            <Link href="/login" className={buttonClass("secondary")}>Sign in</Link>
          </nav>
        </header>

        <section className="grid gap-12 py-16 md:grid-cols-2 md:items-center md:py-24">
          <div>
            <p className="text-sm font-medium text-indigo-600">Pay per email. No subscription.</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">Your cold email. Researched first lines.</h1>
            <p className="mt-5 text-lg text-slate-600">
              Keep your own copy. FirstLine writes only the personal lines, based on real facts from each company&apos;s website, with a source for every claim.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link href="/login" className={buttonClass("primary", "px-5 py-2.5")}>Get 25 free credits</Link>
              <span className="text-sm text-slate-500">Free preview of 5 leads. No card needed.</span>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-[15px] leading-relaxed text-slate-700 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Your email, personalised</p>
            <p className="mt-3">Hi Sanne,</p>
            <p className="mt-3">
              <mark className="rounded bg-indigo-100 px-1 text-indigo-900">Saw that Bakkerij Vos just opened a second shop in Utrecht-Oost, congrats.</mark>
              <sup className="ml-0.5 text-[10px] font-semibold text-indigo-600">[F2]</sup>
            </p>
            <p className="mt-3">We help bakeries cut waste with daily order forecasts. Worth a quick call next week?</p>
            <p className="mt-3">Tom</p>
            <div className="mt-5 border-t border-slate-200 pt-3 text-xs text-slate-500">
              <span className="font-medium text-slate-600">F2</span> &ldquo;Vanaf 1 maart ook in Utrecht-Oost&rdquo; · bakkerijvos.nl/nieuws
            </div>
          </div>
        </section>

        <section className="py-12">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">How it works</h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-xl border border-slate-200 p-5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">{i + 1}</span>
                <h3 className="mt-4 font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="py-12">
          <div className="grid gap-6 sm:grid-cols-2">
            {PROMISES.map((p) => (
              <div key={p.title} className="rounded-xl bg-slate-50 p-6">
                <h3 className="font-semibold text-slate-900">{p.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{p.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="pricing" className="py-12">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Simple pricing</h2>
          <p className="mt-2 text-slate-600">Prepaid credits that never expire. 1 credit = 1 personalised email. Sending from Gmail and plain follow-ups are free.</p>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            {packs.map((p) => (
              <div key={p.id} className={`rounded-xl border p-6 ${p.id === "growth" ? "border-indigo-600 ring-1 ring-indigo-600" : "border-slate-200"}`}>
                <h3 className="font-semibold text-slate-900">{p.name}</h3>
                <p className="mt-3 text-3xl font-semibold text-slate-900">{euro(p.priceCents)}</p>
                <p className="mt-1 text-sm text-slate-500">excl. VAT</p>
                <p className="mt-4 text-sm text-slate-700">{p.credits.toLocaleString("en-US")} emails · {perEmail(p)} each</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-slate-500">Only leads that get a finished email use a credit. Economy mode (results within hours) and extra research options are available inside the app.</p>
        </section>

        <section id="faq" className="py-12">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Questions</h2>
          <dl className="mt-6 divide-y divide-slate-200">
            {FAQ.map((f) => (
              <div key={f.q} className="py-5">
                <dt className="font-medium text-slate-900">{f.q}</dt>
                <dd className="mt-2 text-slate-600">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="my-12 rounded-2xl bg-indigo-600 px-8 py-12 text-center text-white">
          <h2 className="text-2xl font-semibold">Try it on your own leads</h2>
          <p className="mt-2 text-indigo-100">25 free credits after you confirm your email.</p>
          <Link href="/login" className="mt-6 inline-block rounded-lg bg-white px-5 py-2.5 font-medium text-indigo-700 hover:bg-indigo-50">Get started</Link>
        </section>

        <footer className="flex flex-col gap-4 border-t border-slate-200 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 FirstLine</span>
          <nav className="flex flex-wrap gap-5">
            <Link href="/privacy" className="hover:text-slate-900">Privacy</Link>
            <Link href="/terms" className="hover:text-slate-900">Terms</Link>
            <Link href="/dpa" className="hover:text-slate-900">DPA</Link>
            <Link href="/subprocessors" className="hover:text-slate-900">Sub-processors</Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
