import type { RunState } from './probeTypes';
import { createStore } from '../../../shared/idb';
import { dropOldest, keepNewest } from '../../../shared/history';

// Saved probes live in their own IndexedDB database ('probe-history'), separate from the
// scraper's ('directory-scraper'). IndexedDB has far more room than localStorage (about 5 MB),
// which a single large probe could fill on its own.
const { run } = createStore('probe-history', ['runs']);

export const PROBE_HISTORY_LIMIT = 15;
const LEGACY_KEY = 'mcp-probe-run-history';

const startedAt = (r: RunState) => r.startedAt;

/** Saved probes, newest first. */
export async function listRuns(): Promise<RunState[]> {
  const req = await run(['runs'], 'readonly', (tx) => tx.objectStore('runs').getAll() as IDBRequest<RunState[]>);
  return keepNewest(req.result, Number.MAX_SAFE_INTEGER, startedAt);
}

/** Saves (or replaces, by id) a probe, then drops anything beyond the newest 15. Returns the new list. */
export async function saveRun(runState: RunState): Promise<RunState[]> {
  await run(['runs'], 'readwrite', (tx) => {
    tx.objectStore('runs').put(runState);
  });
  const stale = dropOldest(await listRuns(), PROBE_HISTORY_LIMIT, startedAt);
  if (stale.length > 0) {
    try {
      await run(['runs'], 'readwrite', (tx) => {
        for (const s of stale) tx.objectStore('runs').delete(s.id);
      });
    } catch {
      // The probe is saved; trimming will be retried on the next save.
    }
  }
  return listRuns();
}

export async function deleteRun(id: string): Promise<RunState[]> {
  await run(['runs'], 'readwrite', (tx) => {
    tx.objectStore('runs').delete(id);
  });
  return listRuns();
}

/**
 * One-time move of runs saved by earlier versions (localStorage) into IndexedDB. The old key is
 * removed only after the copy succeeded, so a failure loses nothing.
 */
export async function migrateLegacyHistory(): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  let legacy: RunState[];
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    legacy = JSON.parse(raw) as RunState[];
  } catch {
    return;
  }
  try {
    if (Array.isArray(legacy) && legacy.length > 0) {
      await run(['runs'], 'readwrite', (tx) => {
        for (const r of keepNewest(legacy, PROBE_HISTORY_LIMIT, startedAt)) tx.objectStore('runs').put(r);
      });
    }
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Keep the old data in place and try again next time.
  }
}
