import { checkSSRF } from './ssrf.js';
import { acquireHostLock } from './rateLimit.js';
import { z } from 'zod';

const ALLOWED_HEADERS = new Set([
  'content-type',
  'accept',
  'mcp-protocol-version',
  'user-agent',
]);

const BODY_CAP = 256 * 1024;
const MAX_REDIRECTS = 3;

export const ProbeRequestSchema = z.object({
  method: z.enum(['GET', 'POST']),
  url: z.string().url(),
  headers: z.record(z.string()).optional().default({}),
  body: z.string().optional(),
  allowHttp: z.boolean().optional().default(false),
  delayMs: z.number().min(0).max(10000).optional().default(500),
  timeoutMs: z.number().min(100).max(60000).optional().default(10000),
});

export type ProbeRequest = z.infer<typeof ProbeRequestSchema>;

export interface ProbeResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
  bodyJson: unknown;
  contentType: string;
  elapsedMs: number;
  finalUrl: string;
  redirectHops: string[];
  error?: string;
}

export async function executeProbe(req: ProbeRequest): Promise<ProbeResponse> {
  const host = new URL(req.url).hostname;
  const release = await acquireHostLock(host, req.delayMs ?? 500);
  const start = Date.now();
  const redirectHops: string[] = [];
  let currentUrl = req.url;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    // Build safe headers filtered to allowlist
    const safeHeaders: Record<string, string> = {
      'User-Agent': 'MCP-Auth-Discovery-Probe/1.0',
    };
    for (const [k, v] of Object.entries(req.headers ?? {})) {
      if (ALLOWED_HEADERS.has(k.toLowerCase())) {
        safeHeaders[k] = v;
      }
    }

    let response: Response | null = null;

    const controller = new AbortController();
    // The timer stays armed through the body read so a stream that never closes cannot hang the probe.
    timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 10000);

    {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        await checkSSRF(currentUrl, req.allowHttp ?? false);

        const fetchOpts: RequestInit = {
          method: req.method,
          headers: safeHeaders,
          redirect: 'manual',
          signal: controller.signal,
        };

        if (req.method === 'POST' && req.body != null) {
          fetchOpts.body = req.body;
        }

        response = await fetch(currentUrl, fetchOpts);

        const isRedirect = response.status >= 300 && response.status < 400;
        const location = response.headers.get('location');

        if (isRedirect && location && hop < MAX_REDIRECTS) {
          redirectHops.push(currentUrl);
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }
        break;
      }
    }

    if (!response) throw new Error('No response received');

    // If the body never finishes (SSE), keep the status and headers we already have.
    let rawBuffer: ArrayBuffer;
    try {
      rawBuffer = await response.arrayBuffer();
    } catch {
      rawBuffer = new ArrayBuffer(0);
    }
    const sliced =
      rawBuffer.byteLength > BODY_CAP ? rawBuffer.slice(0, BODY_CAP) : rawBuffer;
    const bodyText = new TextDecoder().decode(sliced);

    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });

    const contentType = headers['content-type'] ?? '';
    let bodyJson: unknown = null;
    try {
      const trimmed = bodyText.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        bodyJson = JSON.parse(bodyText);
      }
    } catch {
      bodyJson = null;
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      bodyText,
      bodyJson,
      contentType,
      elapsedMs: Date.now() - start,
      finalUrl: currentUrl,
      redirectHops,
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      status: 0,
      statusText: 'Error',
      headers: {},
      bodyText: '',
      bodyJson: null,
      contentType: '',
      elapsedMs: Date.now() - start,
      finalUrl: currentUrl,
      redirectHops,
      error,
    };
  } finally {
    clearTimeout(timer);
    release();
  }
}
