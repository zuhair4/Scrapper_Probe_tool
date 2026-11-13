import express from 'express';
import { execFile } from 'node:child_process';

// Local proxy for the chatgpt.com plugin directory API. The page cannot call chatgpt.com itself
// (cross-origin), so it calls these routes and this server makes the request:
//   GET /api/chatgpt/home                 -> /backend-api/ps/plugins/home
//   GET /api/chatgpt/category/:slug       -> /backend-api/ps/plugin-categories/:slug/plugins?scope=GLOBAL&limit=100
//   GET /api/chatgpt/plugin/:id           -> /backend-api/ps/plugins/:id
//   POST /api/chatgpt/plugins/batch       -> the same, for up to 25 ids at once (a few at a time)
// Nothing is stored. The category route is the "fetch live" feature (in development): chatgpt.com has
// answered server-side requests for the category lists with a Cloudflare challenge, in which case the
// page says so and the HAR captured in the user's own browser (frontend/src/features/chatgpt-scraper/capture-chatgpt-har.js) is the
// way to get them.
// The upstream host and paths are fixed, so this cannot be pointed anywhere else. Requests are
// spaced out, and a 401/403/429 is reported as is: it is not retried or worked around.

const BASE = 'https://chatgpt.com/backend-api/ps';
/** Query parameters the category route may pass a continuation value in. Must match CURSOR_PARAMS in frontend/src/features/chatgpt-scraper/liveCategory.ts. */
const CURSOR_PARAMS = new Set(['cursor', 'after', 'page_token', 'pageToken', 'next_cursor', 'next', 'token']);
const CURSOR_VALUE = /^[A-Za-z0-9_\-=.+/~:]{1,4000}$/;
const MIN_GAP_MS = 125; // at most 8 request starts a second
const BATCH_MAX = 50;
const BATCH_CONCURRENCY = 4;
const TIMEOUT_MS = 30_000;

const HEADERS: Record<string, string> = {
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.9',
  connection: 'keep-alive',
  dnt: '1',
  'oai-language': 'en-US',
  'oai-product-sku': 'CONNECTOR_SETTING',
  referer: 'https://chatgpt.com/',
  'sec-ch-ua': '"Microsoft Edge";v="155", "Chromium";v="155", "Not(A:Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0',
  'x-codex-surface': 'plugin_directory',
  originator: 'Codex Browser',
  'x-openai-codex-window-type': 'browser',
  'x-openai-web-frontend': 'codex_webview',
};

const SLUG = /^[A-Za-z0-9_~-]{1,80}$/; // ids such as plugins~Plugin_... exist
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export interface Upstream {
  status: number;
  text: string;
}
export type UpstreamFetch = (url: string, surface: string, extraHeaders?: Record<string, string>) => Promise<Upstream>;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const CURL_BIN = process.platform === 'win32' ? 'curl.exe' : 'curl';

// ASCII Record Separator — never appears in a JSON body, safe as a sentinel between body and status.
const SEP = '\x1e';

/** Calls the system curl binary so Cloudflare sees the same TLS fingerprint as a real browser curl. */
function curlOnce(url: string, surface: string, extraHeaders?: Record<string, string>): Promise<Upstream> {
  return new Promise((resolve, reject) => {
    const headers = { ...HEADERS, 'x-codex-surface': surface, ...extraHeaders };
    // SEP separates the body from the HTTP status code; trim() handles Windows CRLF trailing bytes.
    const args = ['-sS', '-L', '--max-time', String(Math.ceil(TIMEOUT_MS / 1000)), '-w', `${SEP}%{http_code}`];
    if (process.platform === 'win32') args.push('--ssl-no-revoke'); // skip CRL checks that fail on some corporate proxies
    const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
    if (proxy) args.push('--proxy', proxy);
    for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
    args.push(url);
    execFile(CURL_BIN, args, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      const si = stdout ? stdout.lastIndexOf(SEP) : -1;
      if (si === -1) {
        const detail = stderr?.trim().slice(0, 200) || err?.message || 'no output';
        return reject(new Error(`curl failed before receiving a response: ${detail}`));
      }
      const text = stdout.slice(0, si);
      const status = Number(stdout.slice(si + 1).trim());
      if (!status) {
        // status 000 = curl connected but got no HTTP response (TLS failure, proxy block, timeout)
        const detail = stderr?.trim().slice(0, 200) || err?.message || 'connection failed (status 000)';
        return reject(new Error(`curl could not reach chatgpt.com: ${detail}`));
      }
      resolve({ status, text });
    });
  });
}

/** Real network call: curl binary, fixed headers, timeout, retries on 5xx only. */
export const fetchUpstream: UpstreamFetch = async (url, surface, extraHeaders) => {
  for (let attempt = 0; ; attempt++) {
    const result = await curlOnce(url, surface, extraHeaders);
    if (result.status >= 500 && attempt < 2) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    return result;
  }
};

export function describeFailure(status: number, body: string): string {
  if (/cf-mitigated|just a moment|challenge-platform/i.test(body)) return `HTTP ${status}: chatgpt.com answered with a Cloudflare challenge. Not retried or worked around.`;
  if (/netskope|ns-template|AI - Block|AI Redirect/i.test(body)) return `HTTP ${status}: blocked by this network's security gateway, not by ChatGPT. Not retried or worked around.`;
  if (status === 401) return 'HTTP 401: chatgpt.com wants a signed-in session for this call.';
  if (status === 403 || status === 429) return `HTTP ${status}: chatgpt.com refused or rate-limited the request. Wait a while before trying again.`;
  if (status === 404) return 'HTTP 404: chatgpt.com does not know this category or plugin.';
  return `HTTP ${status} from chatgpt.com.`;
}

/** Only this machine may use the proxy, unless running in production or ALLOW_REMOTE is set. */
const localOnly: express.RequestHandler = (req, res, next) => {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.ALLOW_REMOTE === 'true' ||
    LOOPBACK.has(req.socket.remoteAddress ?? '')
  ) {
    return next();
  }
  res.status(403).json({ error: 'Local access only' });
};

export function chatgptRouter(upstream: UpstreamFetch = fetchUpstream, gapMs = MIN_GAP_MS): express.Router {
  const r = express.Router();
  r.use(localOnly);

  // Request starts are spaced gapMs apart (so at most 1000/gapMs a second), but a few may be in
  // flight at once, which is what makes a batch faster than one-by-one.
  let nextStart = 0;
  const paced = async <T,>(fn: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    const start = Math.max(now, nextStart);
    nextStart = start + gapMs;
    if (start > now) await sleep(start - now);
    return fn();
  };

  const forward = async (res: express.Response, url: string, surface: string, extraHeaders?: Record<string, string>) => {
    try {
      const up = await paced(() => upstream(url, surface, extraHeaders));
      if (up.status !== 200) {
        res.status(up.status).json({ error: describeFailure(up.status, up.text), upstreamStatus: up.status });
        return;
      }
      try {
        JSON.parse(up.text);
      } catch {
        res.status(502).json({ error: `chatgpt.com answered 200 but not with JSON (starts: ${up.text.slice(0, 80).replace(/\s+/g, ' ')})` });
        return;
      }
      res.type('application/json').send(up.text);
    } catch (e) {
      res.status(502).json({ error: `Could not reach chatgpt.com: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  // The home request of the plugins page also sends this header.
  r.get('/home', (_req, res) => void forward(res, `${BASE}/plugins/home`, 'plugin_directory', { 'x-openai-rate-limit-join-workspace': '1' }));

  // One page of a category's list. A continuation value from the previous page goes back in the query
  // parameter named by `param` (which of the names chatgpt.com uses has not been confirmed, so the
  // page tries the allowed ones; nothing else is passed on).
  r.get('/category/:slug', (req, res) => {
    const { slug } = req.params;
    const { param, cursor } = req.query;
    if (!SLUG.test(slug)) {
      res.status(400).json({ error: 'Invalid category slug' });
      return;
    }
    const url = new URL(`${BASE}/plugin-categories/${encodeURIComponent(slug)}/plugins`);
    url.searchParams.set('scope', 'GLOBAL');
    url.searchParams.set('limit', '100');
    if (param !== undefined || cursor !== undefined) {
      if (typeof param !== 'string' || typeof cursor !== 'string' || !CURSOR_PARAMS.has(param) || !CURSOR_VALUE.test(cursor)) {
        res.status(400).json({ error: 'Invalid continuation parameter' });
        return;
      }
      url.searchParams.set(param, cursor);
    }
    void forward(res, url.toString(), 'plugin_directory');
  });

  r.get('/plugin/:id', (req, res) => {
    const { id } = req.params;
    if (!SLUG.test(id)) {
      res.status(400).json({ error: 'Invalid plugin id' });
      return;
    }
    void forward(res, `${BASE}/plugins/${encodeURIComponent(id)}`, 'other');
  });

  interface BatchItem {
    id: string;
    /** 200 fetched, 0 not fetched (the batch stopped early), anything else a failure. */
    status: number;
    data?: unknown;
    error?: string;
  }

  r.post('/plugins/batch', express.json({ limit: '100kb' }), async (req, res) => {
    const ids = (req.body as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > BATCH_MAX || !ids.every((i) => typeof i === 'string' && SLUG.test(i))) {
      res.status(400).json({ error: `Expected { ids: [1 to ${BATCH_MAX} plugin ids] }` });
      return;
    }
    const results: BatchItem[] = ids.map((id) => ({ id: id as string, status: 0 }));
    let blocked = null as string | null;
    let next = 0;
    const worker = async () => {
      while (!blocked) {
        const i = next++;
        if (i >= ids.length) return;
        const id = ids[i] as string;
        try {
          const up = await paced(() => upstream(`${BASE}/plugins/${encodeURIComponent(id)}`, 'other'));
          if (up.status === 200) {
            try {
              results[i] = { id, status: 200, data: JSON.parse(up.text) };
            } catch {
              results[i] = { id, status: 502, error: 'Answer was not JSON' };
            }
          } else {
            results[i] = { id, status: up.status, error: describeFailure(up.status, up.text) };
            // Refused or rate-limited: stop the whole batch, do not keep asking.
            if (up.status === 401 || up.status === 403 || up.status === 429) blocked = describeFailure(up.status, up.text);
          }
        } catch (e) {
          results[i] = { id, status: 502, error: e instanceof Error ? e.message : String(e) };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, ids.length) }, worker));
    res.json({ results, blocked });
  });

  return r;
}
