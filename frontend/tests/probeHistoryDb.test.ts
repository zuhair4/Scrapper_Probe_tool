import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  PROBE_HISTORY_LIMIT,
  deleteRun,
  listRuns,
  migrateLegacyHistory,
  saveRun,
} from '../src/features/probe/lib/probeHistoryDb';
import { DEFAULT_SETTINGS } from '../src/features/probe/lib/probeTypes';
import type { RunState } from '../src/features/probe/lib/probeTypes';

const within = <T>(p: Promise<T>, ms = 5000) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms))]);

const mkRun = (id: string, startedAt: number, endpoints = 0): RunState => ({
  id,
  label: id,
  startedAt,
  settings: DEFAULT_SETTINGS,
  status: 'complete',
  endpoints: Array.from({ length: endpoints }, (_, i) => ({
    id: `${id}-e${i}`,
    url: `https://e${i}.example.com/mcp`,
    startedAt: 1,
    completedAt: 2,
    attempts: [],
    prm: { found: false, resourceMismatch: false },
    as: { found: false, issuerMismatch: false },
    classification: {} as never,
    dcrResults: [],
  })),
});

beforeEach(async () => {
  for (const r of await listRuns()) await deleteRun(r.id);
});

describe('probe history storage', () => {
  it('saves, lists newest first, replaces by id, and deletes', async () => {
    await within(saveRun(mkRun('a', 100)));
    await within(saveRun(mkRun('b', 200)));
    let list = await within(saveRun({ ...mkRun('a', 100), label: 'renamed' }));
    expect(list.map((r) => r.id)).toEqual(['b', 'a']);
    expect(list.find((r) => r.id === 'a')?.label).toBe('renamed');

    list = await within(deleteRun('b'));
    expect(list.map((r) => r.id)).toEqual(['a']);
  });

  it('keeps only the newest 15 when a 16th is saved', async () => {
    for (let i = 1; i <= PROBE_HISTORY_LIMIT + 1; i++) await saveRun(mkRun(`r${i}`, i));
    const list = await within(listRuns());
    expect(list).toHaveLength(PROBE_HISTORY_LIMIT);
    expect(list[0].id).toBe('r16');
    expect(list.map((r) => r.id)).not.toContain('r1');
  });

  it('saves a very large probe that would not fit in localStorage', async () => {
    const big = mkRun('big', 1, 300);
    // ~12 MB of response text, well past localStorage's ~5 MB limit
    big.endpoints.forEach((e) => {
      e.attempts = [{ id: 'x', stepLabel: 's', url: e.url, method: 'GET', requestHeaders: {}, hit: false, timestamp: 0,
        response: { status: 200, statusText: 'OK', headers: {}, bodyText: 'x'.repeat(40_000), bodyJson: null, contentType: '', elapsedMs: 1, finalUrl: '', redirectHops: [] } }];
    });
    const list = await within(saveRun(big), 15000);
    expect(list[0].endpoints).toHaveLength(300);
    expect(list[0].endpoints[299].attempts[0].response?.bodyText.length).toBe(40_000);
  });
});

describe('legacy localStorage migration', () => {
  it('moves old runs into IndexedDB, then removes the old key', async () => {
    const store: Record<string, string> = { 'mcp-probe-run-history': JSON.stringify([mkRun('old1', 10), mkRun('old2', 20)]) };
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
      removeItem: (k: string) => void delete store[k],
    };
    try {
      await within(migrateLegacyHistory());
      expect((await listRuns()).map((r) => r.id)).toEqual(['old2', 'old1']);
      expect(store['mcp-probe-run-history']).toBeUndefined();
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
