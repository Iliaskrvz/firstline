// The frame and small building blocks shared by every marketing page: header, footer, the [n]
// footnote motif, section headings. Copy comes from src/content/site.ts.
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass, Logo } from "@/components/ui";
import { SITE, type Locale } from "@/content/site";

/** The footnote marker, the brand motif. */
export function Cite({ n, className = "" }: { n: ReactNode; className?: string }) {
  return <span className={`cite text-[0.62em] align-super ${className}`}>[{n}]</span>;
}

/** Section label as a citation: "[2] How it works". */
export function Eyebrow({ n, children, dark }: { n: number | string; children: ReactNode; dark?: boolean }) {
  return (
    <p className={`font-mono text-[13px] tracking-wide ${dark ? "text-slate-300" : "text-slate-600"}`}>
      <span className={dark ? "text-brand-300" : "text-brand-700"}>[{n}]</span> {children}
    </p>
  );
}

export function H1({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h1 className={`font-display text-[38px] leading-[1.07] font-medium tracking-tight sm:text-[52px] ${className}`}>{children}</h1>;
}

export function H2({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`font-display mt-3 text-[34px] leading-[1.1] font-medium tracking-tight sm:text-[46px] ${className}`}>{children}</h2>;
}

export function Check({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function Cross({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" className={className} aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function WindowDots({ dark }: { dark?: boolean }) {
  const c = dark ? "bg-slate-700" : "bg-slate-300";
  return (
    <span className="flex gap-1.5" aria-hidden>
      <span className={`size-2.5 rounded-full ${c}`} />
      <span className={`size-2.5 rounded-full ${c}`} />
      <span className={`size-2.5 rounded-full ${c}`} />
    </span>
  );
}

/** A page section with the standard width and spacing. */
export function Section({ id, className = "", children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={`scroll-mt-20 py-16 md:py-24 ${className}`}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">{children}</div>
    </section>
  );
}

/** The dark closing band with the main call to action. */
export function CtaBand({ title, sub, cta, href = "/signup" }: { title: string; sub?: string; cta: string; href?: string }) {
  return (
    <section className="px-4 py-16 sm:px-6 md:py-24">
      <div className="bg-grid-dark mx-auto max-w-6xl rounded-[32px] bg-slate-950 px-6 py-14 text-center text-white sm:px-12 md:py-16">
        <h2 className="font-display text-[32px] leading-tight font-medium tracking-tight sm:text-[42px]">{title}</h2>
        {sub && <p className="mt-3 text-[17px] text-slate-300">{sub}</p>}
        <Link href={href as "/signup"} className={buttonClass("accent", "mt-8 rounded-full px-6 py-3 text-[15px]")}>
          {cta} <span aria-hidden>›</span>
        </Link>
      </div>
    </section>
  );
}

/**
 * Header and footer around a marketing page. `alternate` is the same page in the other language
 * (the language switch goes there); without one it goes to the other language's homepage.
 */
export function MarketingShell({ locale, alternate, children }: { locale: Locale; alternate?: string; children: ReactNode }) {
  const t = SITE[locale];
  const home = locale === "nl" ? "/nl" : "/";
  const other = alternate ?? (locale === "nl" ? "/" : "/nl");
  const signup = "/signup";
  return (
    <div lang={locale}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        {t.skip}
      </a>
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-[#fbfaf7]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href={home as "/"} aria-label={t.home}>
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-6 text-sm text-slate-700 lg:flex">
            {t.nav.map((l) => (
              <Link key={l.href} href={l.href as "/"} className="hover:text-slate-950">
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 sm:gap-4">
            <Link
              href={other as "/"}
              hrefLang={t.switchLang}
              lang={t.switchLang}
              className="rounded-md px-1.5 py-1 font-mono text-[12px] text-slate-600 uppercase ring-1 ring-slate-300 hover:text-slate-950"
              aria-label={t.switchTo}
            >
              {t.switchLang}
            </Link>
            <Link href="/login" className="hidden text-sm font-medium text-slate-700 hover:text-slate-950 sm:inline">
              {t.signIn}
            </Link>
            <Link href={signup} className={buttonClass("primary", "rounded-full px-4")}>
              <span className="hidden sm:inline">{t.cta}</span>
              <span className="sm:hidden">{t.ctaShort}</span>
            </Link>
          </div>
        </div>
      </header>

      <main id="main">{children}</main>

      <footer className="border-t border-slate-200/80">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 text-sm sm:px-6 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <div className="space-y-3 text-slate-600">
            <Logo />
            <p>© 2026</p>
          </div>
          {(
            [
              [t.footer.product, t.footer.links.product],
              [t.footer.company, t.footer.links.company],
              [t.footer.legal, t.footer.links.legal],
            ] as const
          ).map(([title, links]) => (
            <nav key={title} aria-label={title}>
              <p className="font-mono text-[12px] text-slate-500">{title}</p>
              <ul className="mt-3 space-y-2 text-slate-700">
                {links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href as "/"} className="hover:text-slate-950">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </footer>
    </div>
  );
}
