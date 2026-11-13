// Shared "keep the newest N" rule for both the probe run history (localStorage) and the
// scraper snapshot history (IndexedDB). The two stores themselves are separate.

/** Newest first, truncated to `max`. Does not mutate the input. */
export function keepNewest<T>(items: readonly T[], max: number, timeOf: (item: T) => number): T[] {
  return [...items].sort((a, b) => timeOf(b) - timeOf(a)).slice(0, max);
}

/** The items that fall outside the newest `max` (the ones to delete). */
export function dropOldest<T>(items: readonly T[], max: number, timeOf: (item: T) => number): T[] {
  return [...items].sort((a, b) => timeOf(b) - timeOf(a)).slice(max);
}
