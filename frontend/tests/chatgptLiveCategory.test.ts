import { describe, it, expect } from 'vitest';
import { PsHttpError } from '../src/features/chatgpt-scraper/pluginStore';
import type { PsPlugin } from '../src/features/chatgpt-scraper/pluginStore';
import { CURSOR_PARAMS, readCategory } from '../src/features/chatgpt-scraper/liveCategory';
import type { FetchCategoryPage, Learned } from '../src/features/chatgpt-scraper/liveCategory';

const page = (ids: string[], next?: string) => ({ plugins: ids.map((id) => ({ id, name: id })), ...(next ? { next_cursor: next } : {}) });
const fresh = (): [Map<string, PsPlugin>, Learned] => [new Map(), { param: null }];

describe('readCategory (fetch live)', () => {
  it('reads a single page that has no continuation', async () => {
    const [into, learned] = fresh();
    const r = await readCategory(async () => page(['a', 'b']), into, 'creativity', learned);
    expect(r).toEqual({ plugins: 2, pages: 1, note: '' });
    expect([...into.values()].map((p) => p.categories)).toEqual([['creativity'], ['creativity']]);
  });

  it('follows the continuation under the first parameter name that moves the list, and remembers it', async () => {
    const asked: string[] = [];
    // Only "after" works: the other names are ignored by the endpoint, so it answers page one again.
    const fetchPage: FetchCategoryPage = async (_slug, cont) => {
      if (!cont) return page(['a', 'b'], 'T1');
      asked.push(cont.param);
      if (cont.param !== 'after') return page(['a', 'b'], 'T1');
      return cont.value === 'T1' ? page(['c', 'd'], 'T2') : page(['e']);
    };
    const [into, learned] = fresh();
    const r = await readCategory(fetchPage, into, 'dev', learned);
    expect(r).toEqual({ plugins: 5, pages: 3, note: '' });
    expect(learned.param).toBe('after');
    // First continuation tried cursor, then after; the second one went straight to the learned name.
    expect(asked).toEqual(['cursor', 'after', 'after']);

    // The next category does not guess again.
    const second: string[] = [];
    await readCategory(async (_s, cont) => (cont ? (second.push(cont.param), page(['z'])) : page(['y'], 'X')), new Map(), 'other', learned);
    expect(second).toEqual(['after']);
  });

  it('treats a name the endpoint rejects as "try the next one"', async () => {
    const fetchPage: FetchCategoryPage = async (_s, cont) => {
      if (!cont) return page(['a'], 'T');
      if (cont.param === 'cursor') throw new PsHttpError(400, 'bad request');
      return page(['b']);
    };
    const [into, learned] = fresh();
    const r = await readCategory(fetchPage, into, 'x', learned);
    expect(r.plugins).toBe(2);
    expect(learned.param).toBe('after');
  });

  it('keeps what it read and says so when no name moves the list on', async () => {
    const asked: string[] = [];
    const fetchPage: FetchCategoryPage = async (_s, cont) => (cont && asked.push(cont.param), page(['a', 'b'], 'T'));
    const [into, learned] = fresh();
    const r = await readCategory(fetchPage, into, 'x', learned);
    expect(r.plugins).toBe(2);
    expect(r.note).toMatch(/no query parameter/);
    expect(asked).toEqual(CURSOR_PARAMS);
    expect(learned.param).toBeNull();
  });

  it('throws a refusal at once, and does not try the other names', async () => {
    let calls = 0;
    const fetchPage: FetchCategoryPage = async (_s, cont) => {
      calls++;
      if (cont) throw new PsHttpError(429, 'rate-limited');
      return page(['a'], 'T');
    };
    await expect(readCategory(fetchPage, new Map(), 'x', { param: null })).rejects.toMatchObject({ status: 429 });
    expect(calls).toBe(2);
    await expect(readCategory(async () => Promise.reject(new PsHttpError(403, 'Cloudflare')), new Map(), 'x', { param: null })).rejects.toMatchObject({ status: 403 });
  });

  it('turns another failure of the first page into a note, with nothing read', async () => {
    const r = await readCategory(async () => Promise.reject(new PsHttpError(404, 'unknown category')), new Map(), 'x', { param: null });
    expect(r).toEqual({ plugins: 0, pages: 0, note: 'unknown category' });
  });

  it('stops between pages when asked, and says the list is not complete', async () => {
    let stop = false;
    const fetchPage: FetchCategoryPage = async (_s, cont) => {
      stop = true;
      return cont ? page(['b']) : page(['a'], 'T');
    };
    const r = await readCategory(fetchPage, new Map(), 'x', { param: 'cursor' }, () => stop);
    expect(r.plugins).toBe(1);
    expect(r.note).toMatch(/stopped/);
  });
});
