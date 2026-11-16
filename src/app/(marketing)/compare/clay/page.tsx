import { CompareTool, compareToolMetadata } from "@/components/marketing/compare-tool";

export const metadata = compareToolMetadata("clay");

export default function Page() {
  return <CompareTool id="clay" />;
}
