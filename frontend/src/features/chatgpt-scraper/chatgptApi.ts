import { PsHttpError } from './pluginStore';

// The page's calls, made through the app's own backend (backend/src/chatgpt/pluginStoreRouter.ts), which makes the
// request to chatgpt.com. Errors carry the backend's explanation (blocked, rate-limited).

async function request(url: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    if (init?.signal?.aborted) throw new PsHttpError(0, 'Stopped.');
    throw new PsHttpError(0, 'Can’t reach the app’s backend. Start it with npm run dev.');
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error;
    throw new PsHttpError(res.status, msg ?? `Backend answered HTTP ${res.status}. Is it running the latest code (npm run dev)?`);
  }
  return body;
}

export interface BatchItem {
  id: string;
  /** 200 fetched, 0 not fetched (the batch stopped early), anything else a failure. */
  status: number;
  data?: unknown;
  error?: string;
}

export const backendApi = {
  /** The home list: category titles and a teaser of each. */
  home: (signal?: AbortSignal) => request('/api/chatgpt/home', { signal }),
  /** One page of a category's list, optionally continued from the previous page's value (see liveCategory.ts). */
  categoryPage: (slug: string, cont?: { param: string; value: string }, signal?: AbortSignal) =>
    request(`/api/chatgpt/category/${encodeURIComponent(slug)}${cont ? `?param=${encodeURIComponent(cont.param)}&cursor=${encodeURIComponent(cont.value)}` : ''}`, { signal }),
  /** Up to 50 plugin details per call; the backend fetches a few at a time and stops if chatgpt.com refuses. */
  detailBatch: (ids: string[], signal?: AbortSignal) =>
    request('/api/chatgpt/plugins/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }), signal }) as Promise<{
      results: BatchItem[];
      blocked: string | null;
    }>,
};
