import { HydrationBoundary } from "@tanstack/react-query";
import { dehydrateHouse } from "@/lib/prefetch-server";

export default async function FamilyLayout({ children }: { children: React.ReactNode }) {
  const state = await dehydrateHouse("family");
  return <HydrationBoundary state={state}>{children}</HydrationBoundary>;
}
