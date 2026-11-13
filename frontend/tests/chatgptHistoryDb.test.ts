import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { HISTORY_LIMIT, deleteSnapshot, listSnapshots, loadSnapshot, saveSnapshot, type Cat } from '../src/features/chatgpt-scraper/chatgptHistoryDb';
import { normalizePlugin, type PsPlugin } from '../src/features/chatgpt-scraper/pluginStore';

const within = <T>(p: Promise<T>, ms = 3000) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms))]);

const cats: Cat[] = [{ slug: 'travel', title: 'Travel', description: '', teaser: 1, status: 'done' }];
const plugins = (n: number): PsPlugin[] =>
  Array.from({ length: n }, (_, i) => normalizePlugin({ id: `p${i}`, name: `Plugin ${i}`, release: { mcp_servers: [{ key: 'k', metadata: { url: `https://x/${i}/mcp` } }] } }, 'travel') as PsPlugin);

describe('ChatGPT scrape history storage', () => {
  it('saves, lists and loads a scrape with its categories and MCP data, then deletes it', async () => {
    const rec = await within(saveSnapshot(cats, plugins(3)));
    expect(rec).toMatchObject({ count: 3, categories: 1, withDetails: 3, remoteEndpoints: 3 });
    expect((await within(listSnapshots())).map((s) => s.id)).toContain(rec.id);

    const back = await within(loadSnapshot(rec.id));
    expect(back?.cats).toEqual(cats);
    expect(back?.plugins).toHaveLength(3);
    expect(back?.plugins[0].mcp[0].url).toBe('https://x/0/mcp');

    await within(deleteSnapshot(rec.id));
    expect((await within(listSnapshots())).map((s) => s.id)).not.toContain(rec.id);
    expect(await within(loadSnapshot(rec.id))).toBeNull();
  });

  it('keeps only the newest scrapes and removes the oldest data too', async () => {
    for (const s of await listSnapshots()) await deleteSnapshot(s.id);
    const ids: string[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 2; i++) {
      await new Promise((r) => setTimeout(r, 3));
      ids.push((await within(saveSnapshot(cats, plugins(1)))).id);
    }
    const list = await within(listSnapshots());
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list.map((s) => s.id)).toEqual([...ids].reverse().slice(0, HISTORY_LIMIT));
    for (const gone of ids.slice(0, 2)) expect(await loadSnapshot(gone)).toBeNull();
  });

  it('handles a full-size scrape (6k plugins with details) in reasonable time', async () => {
    const rec = await within(saveSnapshot(cats, plugins(6000)), 15000);
    expect((await within(loadSnapshot(rec.id), 15000))?.plugins).toHaveLength(6000);
  });
});
