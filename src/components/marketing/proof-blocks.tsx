// Social proof on the homepage: customer logos, the live counter and testimonials. Each one renders
// nothing unless SHOW_PROOF lets it through (src/lib/proof.ts); placeholders never reach production.
import { cacheLife } from "next/cache";
import type { HomeCopy } from "@/content/home";
import { CUSTOMER_LOGOS, TESTIMONIALS } from "@/content/proof";
import { fmtInt, type Locale } from "@/content/site";
import { proofMode, visibleProof } from "@/lib/proof";
import { counterThreshold, counterVisible, proofCounts, type ProofCounts } from "@/lib/proof-counts";
import { serverPool } from "@/server/db";
import { Eyebrow, H2 } from "./site";

function PlaceholderTag({ text }: { text: string }) {
  return <span className="inline-block rounded-md bg-amber-100 px-2 py-0.5 font-mono text-[11px] text-amber-900">{text}</span>;
}

/** Customer logos, as images (only with the customer's written permission). */
export function LogoStrip({ t }: { t: HomeCopy["proof"] }) {
  const logos = visibleProof(CUSTOMER_LOGOS);
  if (!logos.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
      <span className="font-mono text-[12px] text-slate-600">{t.logosLabel}</span>
      <ul className="flex flex-wrap items-center gap-x-8 gap-y-3">
        {logos.map((l) =>
          l.placeholder || !l.src ? (
            <li key={l.name} className="rounded-md px-3 py-1.5 text-sm text-slate-500 ring-1 ring-amber-400 ring-dashed">
              {l.name}
            </li>
          ) : (
            <li key={l.name}>
              {/* eslint-disable-next-line @next/next/no-img-element -- small static logo files */}
              <img src={l.src} alt={l.name} width={l.width} height={l.height} className="h-7 w-auto opacity-80 grayscale" />
            </li>
          ),
        )}
      </ul>
      {logos.some((l) => l.placeholder) && <PlaceholderTag text={t.placeholder} />}
    </div>
  );
}

/** The real totals, cached for an hour. Any database problem hides the counter instead of breaking the page. */
async function cachedCounts(): Promise<ProofCounts | null> {
  "use cache";
  cacheLife("hours");
  try {
    return await proofCounts(serverPool());
  } catch {
    return null;
  }
}

/** "X emails personalised · Y leads skipped for free", only past the PROOF_COUNTER_MIN threshold. */
export async function LiveCounter({ t, locale }: { t: HomeCopy["proof"]; locale: Locale }) {
  const mode = proofMode();
  const threshold = counterThreshold();
  if (mode === "off" || (mode === "on" && threshold === null)) return null; // no database call at all
  const counts = await cachedCounts();
  if (!counts || !counterVisible(counts, threshold, mode)) return null;
  const text = t.counter.replace("{personalised}", fmtInt(counts.personalised, locale)).replace("{neutral}", fmtInt(counts.neutral, locale));
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-slate-800">
      <span className="relative flex size-2" aria-hidden>
        <span className="absolute inline-flex size-full rounded-full bg-emerald-500 opacity-60 motion-safe:animate-ping" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-600" />
      </span>
      <span className="font-medium tabular-nums">{text}</span>
      <span className="text-sm text-slate-500">{t.counterNote}</span>
      {mode === "preview" && <PlaceholderTag text={t.counterPreview} />}
    </p>
  );
}

/** Quotes from real users, in their own language. */
export function Testimonials({ t, n }: { t: HomeCopy["proof"]; n: number }) {
  const list = visibleProof(TESTIMONIALS);
  if (!list.length) return null;
  return (
    <section className="py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Eyebrow n={n}>{t.testimonialsEyebrow}</Eyebrow>
        <H2>{t.testimonialsTitle}</H2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {list.map((q, i) => (
            <figure key={i} lang={q.language} className={`flex flex-col rounded-2xl bg-white p-6 ring-1 ${q.placeholder ? "ring-2 ring-amber-400" : "ring-slate-200"}`}>
              {q.placeholder && (
                <div className="mb-3">
                  <PlaceholderTag text={t.placeholder} />
                </div>
              )}
              <blockquote className="font-display text-[20px] leading-snug text-slate-900">&ldquo;{q.quote}&rdquo;</blockquote>
              <figcaption className="mt-auto flex items-center gap-3 pt-5 text-sm">
                {q.photo && (
                  // eslint-disable-next-line @next/next/no-img-element -- small static photo
                  <img src={q.photo} alt="" width={36} height={36} className="size-9 rounded-full object-cover" />
                )}
                <span>
                  <span className="block font-medium text-slate-900">{q.name}</span>
                  <span className="block text-slate-600">{q.role}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Whether there's any testimonial to show, so the section numbering can skip it. */
export const hasTestimonials = () => visibleProof(TESTIMONIALS).length > 0;
