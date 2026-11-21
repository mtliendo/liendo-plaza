import { revalidateTag, unstable_cache } from "next/cache";

// Kitchen display polls every minute. Serving those reads from the Vercel data
// cache lets Neon scale to zero; any API write invalidates the tag.
export const HOUSEHOLD_TAG = "household";
export const HOUSEHOLD_CACHE_SECONDS = 60 * 60;

function outsideNext(error: unknown) {
  return error instanceof Error && /incrementalCache|static generation store|outside a request scope/i.test(error.message);
}

export function householdCached<A extends unknown[], R>(fn: (...args: A) => Promise<R>, key: string) {
  const cached = unstable_cache(fn, [key], { tags: [HOUSEHOLD_TAG], revalidate: HOUSEHOLD_CACHE_SECONDS });
  return async (...args: A): Promise<R> => {
    try {
      return await cached(...args);
    } catch (error) {
      if (outsideNext(error)) return fn(...args);
      throw error;
    }
  };
}

export function invalidateHousehold() {
  try {
    revalidateTag(HOUSEHOLD_TAG);
  } catch {
    // Scripts run outside Next have no cache to invalidate.
  }
}
