import { YieldBenchmarkClient } from "@/components/YieldBenchmarkClient";

export const revalidate = 60;

export default async function YieldPage() {
  return <YieldBenchmarkClient />;
}
