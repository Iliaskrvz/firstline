// Layout for the audience pages (small businesses, automation builders), in either language.
// Each section type gets its own shape so the page doesn't become a wall of identical cards.
import Link from "next/link";
import { Check, CtaBand, Eyebrow, H1, H2, MarketingShell, Section, WindowDots } from "@/components/marketing/site";
import { buttonClass } from "@/components/ui";
import type { PersonaCopy, PersonaSection } from "@/content/personas";
import type { Locale } from "@/content/site";

const CODE = `curl -X POST $FIRSTLINE/api/v1/personalize \\
  -H "Authorization: Bearer $FIRSTLINE_KEY" \\
  -H "Idempotency-Key: lead-123" \\
  -d '{"lead": {"email": "sanne@bakkerijvos.nl",
              "website": "bakkerijvos.nl"},
       "campaign_id": "…", "wait": 60}'

// 200 OK
{ "status": "done",
  "result": { "status": "personalised", "confidence": "high",
    "slots": { "opener": "Saw that Bakkerij Vos just opened…" },
    "sources": [{ "fact": "Vanaf 1 maart ook in Utrecht-Oost",
                  "url": "https://bakkerijvos.nl/nieuws" }],
    "credits_used": 1 } }`;

function Block({ s, n }: { s: PersonaSection; n: number }) {
  if (s.kind === "steps")
    return (
      <Section id={s.id} className="bg-white">
        <Eyebrow n={n}>{s.eyebrow}</Eyebrow>
        <H2>{s.title}</H2>
        <ol className="mt-10 grid gap-px overflow-hidden rounded-2xl bg-slate-200 ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-4">
          {s.steps.map((x, i) => (
            <li key={x.title} className="bg-white p-6">
              <span className="cite text-sm">[{i + 1}]</span>
              <h3 className="mt-3 font-semibold">{x.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-700">{x.text}</p>
            </li>
          ))}
        </ol>
      </Section>
    );
  if (s.kind === "points")
    return (
      <Section id={s.id}>
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <Eyebrow n={n}>{s.eyebrow}</Eyebrow>
            <H2>{s.title}</H2>
            {s.text && <p className="mt-4 text-[17px] leading-relaxed text-slate-700">{s.text}</p>}
          </div>
          <ul className="divide-y divide-slate-200 border-y border-slate-200">
            {s.points.map((p) => (
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
    );
  if (s.kind === "facts")
    return (
      <Section id={s.id} className="border-y border-slate-200/80 bg-white">
        <Eyebrow n={n}>{s.eyebrow}</Eyebrow>
        <H2>{s.title}</H2>
        {s.text && <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-slate-700">{s.text}</p>}
        <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-3 lg:grid-cols-5">
          {s.facts.map((f) => (
            <div key={f.label} className="border-t border-slate-200 pt-4">
              <dt className="sr-only">{f.label}</dt>
              <dd>
                <span className="font-display block text-[30px] leading-none tracking-tight text-slate-900 sm:text-[34px]">{f.value}</span>
                <span className="mt-2 block text-sm text-slate-600">{f.label}</span>
              </dd>
            </div>
          ))}
        </dl>
        {s.note && <p className="mt-8 max-w-3xl text-sm text-slate-600">{s.note}</p>}
      </Section>
    );
  if (s.kind === "status")
    return (
      <Section id={s.id}>
        <Eyebrow n={n}>{s.eyebrow}</Eyebrow>
        <H2>{s.title}</H2>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {s.rows.map((r) => (
            <li key={r.name} className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">{r.name}</h3>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${r.ready ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{r.status}</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-700">{r.text}</p>
            </li>
          ))}
        </ul>
        {s.note && <p className="mt-5 max-w-3xl text-sm text-slate-600">{s.note}</p>}
      </Section>
    );
  return (
    <section id={s.id} className="bg-grid-dark scroll-mt-16 bg-slate-950 py-16 text-white md:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.3fr]">
        <div>
          <Eyebrow n={n} dark>
            {s.eyebrow}
          </Eyebrow>
          <H2>{s.title}</H2>
          <p className="mt-4 text-[17px] leading-relaxed text-slate-300">{s.text}</p>
          <Link href={s.link.href as "/"} className="mt-6 inline-flex rounded-full px-[18px] py-2.5 text-sm font-medium text-white ring-1 ring-white/30 hover:bg-white/5">
            {s.link.label} <span aria-hidden className="ml-1">›</span>
          </Link>
        </div>
        <div className="min-w-0 overflow-hidden rounded-2xl bg-[#0b1220] ring-1 ring-white/10">
          <div className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3 text-xs text-slate-400">
            <WindowDots dark />
            <span>POST /api/v1/personalize</span>
          </div>
          <pre className="max-w-full overflow-x-auto p-5 font-mono text-[12px] leading-[1.7] text-slate-300" tabIndex={0} aria-label={s.title} lang="en">
            {CODE}
          </pre>
        </div>
      </div>
    </section>
  );
}

export function PersonaView({ t, locale, alternate }: { t: PersonaCopy; locale: Locale; alternate: string }) {
  return (
    <MarketingShell locale={locale} alternate={alternate}>
      <Section className="pt-14 md:pt-20">
        <p className="font-mono text-[13px] text-slate-600">{t.eyebrow}</p>
        <H1 className="mt-4 max-w-4xl">
          {t.title}
          <span className="mt-2 block text-slate-600">{t.titleMuted}</span>
        </H1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-700">{t.intro}</p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link href={t.ctaHref as "/"} className={buttonClass("accent", "rounded-full px-5 py-3 text-[15px]")}>
            {t.cta} <span aria-hidden>›</span>
          </Link>
          <Link href={t.secondary.href as "/"} className={buttonClass("secondary", "rounded-full px-5 py-3 text-[15px]")}>
            {t.secondary.label}
          </Link>
        </div>
        <p className="mt-3 text-sm text-slate-600">{t.note}</p>
      </Section>
      {t.sections.map((s, i) => (
        <Block key={s.title} s={s} n={i + 1} />
      ))}
      <Section>
        <div className="grid gap-10 md:grid-cols-[1fr_2fr]">
          <h2 className="font-display text-[34px] leading-[1.1] font-medium tracking-tight">{t.faqTitle}</h2>
          <div className="divide-y divide-slate-200 border-y border-slate-200">
            {t.faq.map((f) => (
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
      </Section>
      <CtaBand title={t.finalCta.title} sub={t.finalCta.sub} cta={t.finalCta.cta} href={t.ctaHref} />
    </MarketingShell>
  );
}
