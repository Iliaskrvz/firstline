// The founder line with a photo, or an initials avatar until the photo is there. Rendered only when
// visibleProof() lets it through (SHOW_PROOF on and placeholder: false).
import Image from "next/image";
import { initials, type Founder } from "@/content/proof";

export function FounderNote({ f }: { f: Founder }) {
  return (
    <figure className="mx-auto flex max-w-xl items-center gap-4 text-left">
      {f.photo ? (
        <Image src={f.photo} alt={f.name} width={56} height={56} className="size-14 shrink-0 rounded-full object-cover" />
      ) : (
        <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-full bg-brand-100 font-semibold text-brand-800">
          {initials(f.name)}
        </span>
      )}
      <div>
        <blockquote className="text-[15px] leading-relaxed text-slate-800">{f.line}</blockquote>
        <figcaption className="mt-1 text-sm text-slate-600">
          {f.name} · {f.role}
        </figcaption>
      </div>
    </figure>
  );
}
