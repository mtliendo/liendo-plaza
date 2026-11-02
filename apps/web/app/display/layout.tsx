import { HydrationBoundary } from "@tanstack/react-query";
import { dehydrateHouse } from "@/lib/prefetch-server";

export default async function DisplayLayout({ children }: { children: React.ReactNode }) {
  const state = await dehydrateHouse("display");
  return <HydrationBoundary state={state}>{children}</HydrationBoundary>;
}
