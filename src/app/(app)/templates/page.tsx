import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, buttonClass, Card, PageHeader, Skeleton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import type { TemplateRow } from "@/lib/types";

export const metadata: Metadata = { title: "Templates" };

export default function TemplatesPage() {
  return (
    <>
      <PageHeader
        title="Templates"
        description="Your own copy, with marked slots that FirstLine writes per lead."
        actions={
          <Link href="/templates/new" className={buttonClass("primary")}>
            New template
          </Link>
        }
      />
      <Suspense fallback={<Skeleton className="h-48" />}>
        <TemplateList />
      </Suspense>
    </>
  );
}

async function TemplateList() {
  const { supabase, workspace } = await requireWorkspace();
  const { data, error } = await supabase
    .from("templates")
    .select("id, name, subject, slots, updated_at")
    .eq("workspace_id", workspace.id)
    .eq("source", "app")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as Pick<TemplateRow, "id" | "name" | "subject" | "slots" | "updated_at">[];

  if (rows.length === 0) {
    return (
      <Card className="py-16 text-center">
        <h2 className="text-base font-semibold text-slate-900">No templates yet</h2>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">Paste the cold email you already use and mark where the personal lines go.</p>
        <Link href="/templates/new" className={buttonClass("primary", "mt-6")}>
          Write a template
        </Link>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((t) => (
        <Link key={t.id} href={`/templates/${t.id}`} className="group">
          <Card className="h-full transition-shadow group-hover:shadow-md">
            <div className="font-semibold text-slate-900 group-hover:text-indigo-700">{t.name}</div>
            <div className="mt-1 truncate text-sm text-slate-500">{t.subject || <em>No subject</em>}</div>
            <div className="mt-4 flex flex-wrap gap-1">
              {t.slots.map((s) => (
                <Badge key={s.key} tone="indigo">
                  ✦ {s.key}
                </Badge>
              ))}
            </div>
            <div className="mt-4 text-xs text-slate-400">Updated {formatDate(t.updated_at)}</div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
