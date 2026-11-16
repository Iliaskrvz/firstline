import { CompareTool, compareToolMetadata } from "@/components/marketing/compare-tool";

export const metadata = compareToolMetadata("smartwriter");

export default function Page() {
  return <CompareTool id="smartwriter" />;
}
