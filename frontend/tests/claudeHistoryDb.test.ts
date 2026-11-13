import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { HISTORY_LIMIT, deleteSnapshot, listSnapshots, loadSnapshotItems, saveSnapshot } from '../src/features/claude-scraper/claudeHistoryDb';

// A real hang here (a request waited on after its transaction finished) is what kept the
// scraper's spinner running forever, so every call is raced against a timeout.
const within = <T>(p: Promise<T>, ms = 3000) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms))]);

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `item_${i}`, name: `Item ${i}` }));

describe('scraper history storage', () => {
  it('saves, lists and loads a snapshot without hanging', async () => {
    const rec = await within(saveSnapshot({ pages: 2, connectors: 1 }, items(3)));
    expect(rec.count).toBe(3);

    const list = await within(listSnapshots());
    expect(list.map((s) => s.id)).toContain(rec.id);

    const loaded = await within(loadSnapshotItems(rec.id));
    expect(loaded).toHaveLength(3);
    expect(loaded[0]).toEqual({ id: 'item_0', name: 'Item 0' });

    await within(deleteSnapshot(rec.id));
    expect((await within(listSnapshots())).map((s) => s.id)).not.toContain(rec.id);
    expect(await within(loadSnapshotItems(rec.id))).toEqual([]);
  });

  it('keeps only the newest 15 and removes the oldest data too', async () => {
    for (const s of await listSnapshots()) await deleteSnapshot(s.id);

    const ids: string[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 3; i++) {
      // distinct ids/timestamps: snapshots are keyed by Date.now()
      await new Promise((r) => setTimeout(r, 3));
      ids.push((await within(saveSnapshot({}, items(1)))).id);
    }

    const list = await within(listSnapshots());
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list.map((s) => s.id)).toEqual([...ids].reverse().slice(0, HISTORY_LIMIT)); // newest first
    for (const gone of ids.slice(0, 3)) expect(await loadSnapshotItems(gone)).toEqual([]);
    expect(await loadSnapshotItems(ids[ids.length - 1])).toHaveLength(1);
  });

  it('handles a full-size scrape (11.5k items) in reasonable time', async () => {
    const t = Date.now();
    const rec = await within(saveSnapshot({}, items(11512)), 15000);
    expect((await within(loadSnapshotItems(rec.id), 15000)).length).toBe(11512);
    expect(Date.now() - t).toBeLessThan(15000);
  });
});
