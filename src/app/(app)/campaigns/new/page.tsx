import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { UploadWizard } from "./upload-wizard";

export const metadata: Metadata = { title: "Upload leads" };

export default function NewCampaignPage() {
  return (
    <>
      <PageHeader title="Upload leads" description="CSV from any tool: Apollo, Clay, a spreadsheet export. We map the columns for you." />
      <UploadWizard />
    </>
  );
}
