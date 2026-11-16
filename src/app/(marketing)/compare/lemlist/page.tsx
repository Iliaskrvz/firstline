import { CompareTool, compareToolMetadata } from "@/components/marketing/compare-tool";

export const metadata = compareToolMetadata("lemlist");

export default function Page() {
  return <CompareTool id="lemlist" />;
}
