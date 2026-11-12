import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import type { TemplateRow } from "@/lib/types";
import { previewContext } from "../load";
import { TemplateEditor } from "../template-editor";

export const metadata: Metadata = { title: "Edit template" };

export default function EditTemplatePage(props: PageProps<"/templates/[id]">) {
  return (
    <>
      <PageHeader title="Edit template" description="Changes apply to campaigns that haven't run yet." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Editor params={props.params} />
      </Suspense>
    </>
  );
}

async function Editor({ params }: { params: PageProps<"/templates/[id]">["params"] }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, workspace } = await requireWorkspace();
  const { data } = await supabase.from("templates").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const ctx = await previewContext(supabase, null, workspace.id);
  return <TemplateEditor template={data as TemplateRow} campaignId={null} {...ctx} />;
}
