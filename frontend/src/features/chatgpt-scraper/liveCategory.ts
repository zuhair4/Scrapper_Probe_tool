import { PsHttpError, ingestCategoryPage } from './pluginStore';
import type { PsPlugin } from './pluginStore';

// Reading one category's full list from the app's backend ("fetch live", in development). The category
// endpoint answers up to 100 plugins at a time and says whether there is more, but which query parameter
// carries the continuation value has not been confirmed. The first time a category has a second page
// the allowed names are tried in turn; the one that returns plugins not seen before is kept for the rest.

/** Must match CURSOR_PARAMS in backend/src/chatgpt/pluginStoreRouter.ts (the backend passes nothing else on). */
export const CURSOR_PARAMS = ['cursor', 'after', 'page_token', 'pageToken', 'next_cursor', 'next', 'token'];
const MAX_PAGES = 50;
const REFUSED = [401, 403, 429];

export type FetchCategoryPage = (slug: string, cont?: { param: string; value: string }) => Promise<unknown>;

export interface CategoryRead {
  /** Distinct plugins this category's pages returned. */
  plugins: number;
  pages: number;
  /** Why the list may be incomplete; empty when the last page said there was no more. */
  note: string;
}

/** Remembered across categories: the parameter name that worked. */
export interface Learned {
  param: string | null;
}

/**
 * Reads every page of one category into `into`. A refusal (401, 403, 429) is thrown so the caller can stop;
 * any other failure ends this category with a note and keeps what was read.
 */
export async function readCategory(fetchPage: FetchCategoryPage, into: Map<string, PsPlugin>, slug: string, learned: Learned, shouldStop: () => boolean = () => false): Promise<CategoryRead> {
  const seen = new Set<string>();
  const take = (json: unknown) => {
    const page = ingestCategoryPage(into, json, slug);
    const fresh = page.items.filter((p) => !seen.has(p.id || p.name));
    for (const p of fresh) seen.add(p.id || p.name);
    return { next: page.next, fresh: fresh.length };
  };
  const result = (pages: number, note: string): CategoryRead => ({ plugins: seen.size, pages, note });

  let pages = 0;
  let cur: { next: string | null; fresh: number };
  try {
    cur = take(await fetchPage(slug));
  } catch (e) {
    if (e instanceof PsHttpError && REFUSED.includes(e.status)) throw e;
    return result(0, e instanceof Error ? e.message : String(e));
  }
  pages = 1;

  while (cur.next && cur.fresh && pages < MAX_PAGES && !shouldStop()) {
    const value = cur.next;
    let following: { next: string | null; fresh: number } | null = null;
    for (const param of learned.param ? [learned.param] : CURSOR_PARAMS) {
      try {
        const t = take(await fetchPage(slug, { param, value }));
        if (t.fresh) {
          learned.param = param;
          following = t;
          break;
        }
      } catch (e) {
        if (e instanceof PsHttpError && REFUSED.includes(e.status)) throw e;
        // a name the endpoint rejects: try the next one
      }
    }
    if (!following) return result(pages, 'there are more pages, but no query parameter moved the list on');
    pages++;
    cur = following;
  }
  if (cur.next && cur.fresh) return result(pages, pages >= MAX_PAGES ? `stopped after ${MAX_PAGES} pages` : 'stopped before the last page');
  return result(pages, '');
}
