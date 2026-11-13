import type { Item } from './claudeDirectory';
import { dropOldest } from '../../shared/history';
import { createStore } from '../../shared/idb';

export interface SnapshotMeta {
  id: string;
  savedAt: string;
  /** When the data was fetched (savedAt is when it was saved). Used as the report's as-of date. */
  fetchedAt?: string;
  count: number;
  pages?: number;
  expected?: number;
  connectors?: number;
  plugins?: number;
  extensions?: number;
}

// Its own database ('directory-scraper'); the probe history uses a different one.
const { run } = createStore('directory-scraper', ['meta', 'data']);

// Only the newest HISTORY_LIMIT snapshots are kept; each save drops the oldest beyond that.
export const HISTORY_LIMIT = 15;

export async function saveSnapshot(meta: Partial<SnapshotMeta>, items: Item[]): Promise<SnapshotMeta> {
  const id = `snap_${Date.now()}`;
  const record: SnapshotMeta = { id, savedAt: new Date().toISOString(), count: items.length, ...meta };
  await run(['meta', 'data'], 'readwrite', (tx) => {
    tx.objectStore('meta').put(record);
    tx.objectStore('data').put({ id, items });
  });
  try {
    await pruneSnapshots();
  } catch {
    // The snapshot is saved; trimming old ones will be retried on the next save.
  }
  return record;
}

export async function pruneSnapshots(limit = HISTORY_LIMIT): Promise<string[]> {
  const stale = dropOldest(await listSnapshots(), limit, (s) => Date.parse(s.savedAt));
  if (stale.length === 0) return [];
  await run(['meta', 'data'], 'readwrite', (tx) => {
    for (const s of stale) {
      tx.objectStore('meta').delete(s.id);
      tx.objectStore('data').delete(s.id);
    }
  });
  return stale.map((s) => s.id);
}

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  const req = await run(['meta'], 'readonly', (tx) => tx.objectStore('meta').getAll() as IDBRequest<SnapshotMeta[]>);
  return [...req.result].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function loadSnapshotItems(id: string): Promise<Item[]> {
  const req = await run(
    ['data'],
    'readonly',
    (tx) => tx.objectStore('data').get(id) as IDBRequest<{ id: string; items: Item[] } | undefined>
  );
  return req.result?.items ?? [];
}

export async function deleteSnapshot(id: string): Promise<void> {
  await run(['meta', 'data'], 'readwrite', (tx) => {
    tx.objectStore('meta').delete(id);
    tx.objectStore('data').delete(id);
  });
}
