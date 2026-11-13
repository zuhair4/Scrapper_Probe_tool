import type { PsCategory, PsPlugin } from './pluginStore';
import { dropOldest } from '../../shared/history';
import { createStore } from '../../shared/idb';

export interface Cat extends PsCategory {
  /** 'done' once the capture had the category's full list; 'listed' when only the home teaser was there. */
  status: 'listed' | 'done';
}

export interface SnapshotMeta {
  id: string;
  savedAt: string;
  count: number;
  categories: number;
  withDetails: number;
  remoteEndpoints: number;
}

export interface Snapshot {
  cats: Cat[];
  plugins: PsPlugin[];
}

// Its own database; the Claude scraper history and the probe history use different ones.
const { run } = createStore('chatgpt-scraper', ['meta', 'data']);

// Each snapshot holds every plugin with its details (several MB), so fewer are kept than for Claude.
export const HISTORY_LIMIT = 10;

/** Saves what is on screen. Only called when the user clicks Save scrape. */
export async function saveSnapshot(cats: Cat[], plugins: PsPlugin[]): Promise<SnapshotMeta> {
  const id = `snap_${Date.now()}`;
  const record: SnapshotMeta = {
    id,
    savedAt: new Date().toISOString(),
    count: plugins.length,
    categories: cats.length,
    withDetails: plugins.filter((p) => p.hasDetail).length,
    remoteEndpoints: plugins.filter((p) => p.mcpStatus === 'remote').length,
  };
  await run(['meta', 'data'], 'readwrite', (tx) => {
    tx.objectStore('meta').put(record);
    tx.objectStore('data').put({ id, cats, plugins });
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

export async function loadSnapshot(id: string): Promise<Snapshot | null> {
  const req = await run(['data'], 'readonly', (tx) => tx.objectStore('data').get(id) as IDBRequest<({ id: string } & Snapshot) | undefined>);
  const r = req.result;
  return r ? { cats: r.cats, plugins: r.plugins } : null;
}

export async function deleteSnapshot(id: string): Promise<void> {
  await run(['meta', 'data'], 'readwrite', (tx) => {
    tx.objectStore('meta').delete(id);
    tx.objectStore('data').delete(id);
  });
}
