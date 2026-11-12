import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { previewContext } from "../load";
import { TemplateEditor } from "../template-editor";

export const metadata: Metadata = { title: "New template" };

export default function NewTemplatePage(props: PageProps<"/templates/new">) {
  return (
    <>
      <PageHeader title="New template" description="Paste your own cold email. Mark the parts FirstLine should write with [[slots]]." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Editor searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Editor({ searchParams }: { searchParams: PageProps<"/templates/new">["searchParams"] }) {
  const sp = await searchParams;
  const campaignId = typeof sp.campaign === "string" && /^[0-9a-f-]{36}$/i.test(sp.campaign) ? sp.campaign : null;
  const { supabase, workspace } = await requireWorkspace();
  const ctx = await previewContext(supabase, campaignId, workspace.id);
  return <TemplateEditor template={null} campaignId={campaignId} {...ctx} />;
}
