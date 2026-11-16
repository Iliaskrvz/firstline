import { CompareTool, compareToolMetadata } from "@/components/marketing/compare-tool";

export const metadata = compareToolMetadata("instantly");

export default function Page() {
  return <CompareTool id="instantly" />;
}
