import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui";
import { company, LEGAL_UPDATED, SUBPROCESSORS } from "@/lib/legal";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const c = company();
  return (
    <div className="mx-auto max-w-3xl px-6 pb-24">
      <header className="flex items-center justify-between py-6">
        <Link href="/">
          <Logo />
        </Link>
        <nav className="flex gap-4 text-sm text-slate-600">
          <Link href="/privacy" className="hover:text-slate-900">Privacy</Link>
          <Link href="/terms" className="hover:text-slate-900">Terms</Link>
          <Link href="/dpa" className="hover:text-slate-900">DPA</Link>
          <Link href="/subprocessors" className="hover:text-slate-900">Sub-processors</Link>
        </nav>
      </header>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated {LEGAL_UPDATED}.</p>
      {!c.complete && (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">Draft: the company details on this page are still being completed.</p>
      )}
      <div className="legal mt-8 space-y-4 text-[15px] leading-relaxed text-slate-700 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc">
        {children}
      </div>
    </div>
  );
}

export function SubprocessorTable() {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2 font-medium">Company</th>
            <th className="px-3 py-2 font-medium">What for</th>
            <th className="px-3 py-2 font-medium">Data</th>
            <th className="px-3 py-2 font-medium">Where</th>
          </tr>
        </thead>
        <tbody>
          {SUBPROCESSORS.map((s) => (
            <tr key={s.name} className="border-t border-slate-100 align-top">
              <td className="px-3 py-2 font-medium text-slate-900">{s.name}</td>
              <td className="px-3 py-2">{s.purpose}</td>
              <td className="px-3 py-2">{s.data}</td>
              <td className="px-3 py-2">{s.location}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
