export const PRESENCE_INTERVAL_MS = 15 * 60 * 1000;

export function presenceIsStale(lastSeenAt: Date | null, now = new Date()): boolean {
  return !lastSeenAt || now.getTime() - lastSeenAt.getTime() >= PRESENCE_INTERVAL_MS;
}
