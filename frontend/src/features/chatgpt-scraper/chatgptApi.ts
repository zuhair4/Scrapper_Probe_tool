import { PsHttpError } from './pluginStore';

// The page's calls, made through the app's own backend (backend/src/chatgpt/pluginStoreRouter.ts), which makes the
// request to chatgpt.com. Errors carry the exact status code and the backend's explanation (blocked, rate-limited, etc).

async function request(url: string, init?: RequestInit): Promise<unknown> {
  const method = init?.method?.toUpperCase() || 'GET';
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (init?.signal?.aborted) {
      throw new PsHttpError(0, 'Request was stopped / cancelled.', { method, url, cause: err });
    }
    const causeMsg = err instanceof Error ? err.message : String(err);
    const fullMsg = `[Network Error (HTTP 0)] ${method} ${url} failed: ${causeMsg}. Make sure the backend server is running and accessible.`;
    throw new PsHttpError(0, fullMsg, { method, url, details: causeMsg, cause: err });
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }

  if (!res.ok) {
    const errorObj = body as { error?: string; details?: unknown; upstreamStatus?: number } | null;
    let detailMsg = errorObj?.error;
    if (!detailMsg) {
      // If server returned HTML (e.g. 502/504 Bad Gateway from Vite proxy or reverse proxy) or plain text:
      const cleanSnippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      detailMsg = cleanSnippet || res.statusText || 'Unknown server error';
    }
    const upstreamNote = errorObj?.upstreamStatus ? ` (upstream chatgpt.com returned HTTP ${errorObj.upstreamStatus})` : '';
    const detailsStr = errorObj?.details
      ? ` | Details: ${typeof errorObj.details === 'object' ? JSON.stringify(errorObj.details) : String(errorObj.details)}`
      : '';
    const fullMsg = `[HTTP ${res.status}] ${method} ${url} - ${detailMsg}${upstreamNote}${detailsStr}`;
    throw new PsHttpError(res.status, fullMsg, { method, url, details: body || text });
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
