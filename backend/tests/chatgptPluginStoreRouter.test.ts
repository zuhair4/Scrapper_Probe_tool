import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chatgptRouter, describeFailure, type UpstreamFetch } from '../src/chatgpt/pluginStoreRouter';

let server: Server | null = null;
afterEach(() => {
  server?.close();
});

async function start(upstream: UpstreamFetch) {
  const app = express();
  app.use('/api/chatgpt', chatgptRouter(upstream, 0));
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/chatgpt`;
  return (path: string, init?: RequestInit) => fetch(base + path, init);
}

const ok = (o: unknown) => ({ status: 200, text: JSON.stringify(o) });

describe('chatgpt proxy routes', () => {
  it('maps home and plugin to the fixed upstream URLs and surfaces', async () => {
    const calls: Array<[string, string]> = [];
    const get = await start(async (url, surface) => (calls.push([url, surface]), ok({ ok: true })));
    await get('/home');
    await get('/plugin/plugin_connector_68df33b1a2d081918778431a9cfca8ba');
    expect(calls).toEqual([
      ['https://chatgpt.com/backend-api/ps/plugins/home', 'plugin_directory'],
      ['https://chatgpt.com/backend-api/ps/plugins/plugin_connector_68df33b1a2d081918778431a9cfca8ba', 'other'],
    ]);
  });

  it('sends the home request with the extra header the plugins page sends', async () => {
    let extra: Record<string, string> | undefined;
    const get = await start(async (_url, _surface, h) => ((extra = h), ok({})));
    await get('/home');
    expect(extra).toEqual({ 'x-openai-rate-limit-join-workspace': '1' });
  });

  describe('category (fetch live)', () => {
    it('maps to the fixed category URL and the directory surface', async () => {
      const calls: Array<[string, string]> = [];
      const get = await start(async (url, surface) => (calls.push([url, surface]), ok({ plugins: [] })));
      expect((await get('/category/creativity')).status).toBe(200);
      expect(calls).toEqual([['https://chatgpt.com/backend-api/ps/plugin-categories/creativity/plugins?scope=GLOBAL&limit=100', 'plugin_directory']]);
    });

    it('passes a continuation value only under an allowed parameter name', async () => {
      const urls: string[] = [];
      const get = await start(async (url) => (urls.push(url), ok({})));
      expect((await get('/category/creativity?param=page_token&cursor=abc_DEF-123%3D')).status).toBe(200);
      expect(urls[0]).toBe('https://chatgpt.com/backend-api/ps/plugin-categories/creativity/plugins?scope=GLOBAL&limit=100&page_token=abc_DEF-123%3D');
    });

    it('rejects bad slugs, unknown parameter names, odd values and half a continuation, without calling upstream', async () => {
      let called = 0;
      const get = await start(async () => (called++, ok({})));
      expect((await get('/category/a%20b')).status).toBe(400);
      expect((await get('/category/x?param=evil&cursor=abc')).status).toBe(400);
      expect((await get('/category/x?param=cursor&cursor=a%26scope%3Dother')).status).toBe(400);
      expect((await get('/category/x?param=cursor')).status).toBe(400);
      expect((await get('/category/x?cursor=abc')).status).toBe(400);
      expect(called).toBe(0);
    });

    it('reports a Cloudflare challenge with its status', async () => {
      const get = await start(async () => ({ status: 403, text: '<html>Just a moment...</html>' }));
      const res = await get('/category/creativity');
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toMatch(/Cloudflare challenge/);
    });
  });

  it('keeps nothing on disk', async () => {
    let called = 0;
    const get = await start(async () => (called++, ok({})));
    expect((await get('/saved')).status).toBe(404);
    expect((await get('/saved', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
    expect(called).toBe(0);
  });

  it('returns the upstream JSON unchanged', async () => {
    const get = await start(async () => ok({ sections: [{ id: 'featured' }] }));
    const res = await get('/home');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sections: [{ id: 'featured' }] });
  });

  it('rejects slugs and ids that are not plain identifiers, without calling upstream', async () => {
    let called = 0;
    const get = await start(async () => (called++, ok({})));
    expect((await get('/plugin/..%2F..%2Fx')).status).toBe(400);
    expect((await get('/plugin/a%20b')).status).toBe(400);
    expect(called).toBe(0);
  });

  it('reports a Cloudflare challenge with its status and does not retry', async () => {
    let called = 0;
    const get = await start(async () => (called++, { status: 403, text: '<html>cf-mitigated: challenge</html>' }));
    const res = await get('/plugin/abc');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/Cloudflare challenge/);
    expect(called).toBe(1);
  });

  it('turns a non-JSON 200 and a network failure into 502', async () => {
    const a = await start(async () => ({ status: 200, text: '<html>hi</html>' }));
    expect((await a('/home')).status).toBe(502);
    server?.close();
    const b = await start(async () => {
      throw new Error('ENOTFOUND');
    });
    const res = await b('/home');
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/ENOTFOUND/);
  });

  it('describeFailure tells the gateway block from ChatGPT', () => {
    expect(describeFailure(403, '<div class="ns-template-wrap">AI - Block</div>')).toMatch(/security gateway/);
    expect(describeFailure(429, '')).toMatch(/rate-limited/);
    expect(describeFailure(404, '')).toMatch(/does not know/);
  });

  describe('batch', () => {
    const post = (get: Awaited<ReturnType<typeof start>>, body: unknown) =>
      get('/plugins/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    it('fetches every id, returns results in order, with the detail surface', async () => {
      const seen: Array<[string, string]> = [];
      const get = await start(async (url, surface) => (seen.push([url, surface]), ok({ id: url.split('/').pop() })));
      const res = await post(get, { ids: ['a', 'b', 'c', 'd', 'e'] });
      const body = (await res.json()) as { results: Array<{ id: string; status: number; data: { id: string } }>; blocked: string | null };
      expect(body.blocked).toBeNull();
      expect(body.results.map((r) => [r.id, r.status, r.data.id])).toEqual([['a', 200, 'a'], ['b', 200, 'b'], ['c', 200, 'c'], ['d', 200, 'd'], ['e', 200, 'e']]);
      expect(seen).toHaveLength(5);
      expect(seen.every(([u, s]) => u.startsWith('https://chatgpt.com/backend-api/ps/plugins/') && s === 'other')).toBe(true);
    });

    it('runs several at once, but not more than four', async () => {
      let inFlight = 0;
      let peak = 0;
      const get = await start(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 15));
        inFlight--;
        return ok({});
      });
      await post(get, { ids: Array.from({ length: 12 }, (_, i) => 'p' + i) });
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(4);
    });

    it('a single failing plugin does not stop the others', async () => {
      const get = await start(async (url) => (url.endsWith('/bad') ? { status: 404, text: 'nope' } : ok({})));
      const body = (await (await post(get, { ids: ['a', 'bad', 'c'] })).json()) as { results: Array<{ id: string; status: number }>; blocked: string | null };
      expect(body.results.map((r) => r.status)).toEqual([200, 404, 200]);
      expect(body.blocked).toBeNull();
    });

    it('stops the whole batch at the first refusal and says so', async () => {
      let called = 0;
      const get = await start(async () => (called++, { status: 429, text: 'slow down' }));
      const body = (await (await post(get, { ids: Array.from({ length: 25 }, (_, i) => 'p' + i) })).json()) as { results: Array<{ status: number }>; blocked: string | null };
      expect(body.blocked).toMatch(/rate-limited/);
      expect(called).toBeLessThanOrEqual(4);
      expect(body.results.filter((r) => r.status === 0).length).toBeGreaterThan(0);
    });

    it('rejects an empty list, too many ids, and ids that are not plain identifiers', async () => {
      let called = 0;
      const get = await start(async () => (called++, ok({})));
      expect((await post(get, { ids: [] })).status).toBe(400);
      expect((await post(get, { ids: Array.from({ length: 26 }, (_, i) => 'p' + i) })).status).toBe(400);
      expect((await post(get, { ids: ['ok', '../x'] })).status).toBe(400);
      expect((await post(get, { nope: 1 })).status).toBe(400);
      expect(called).toBe(0);
    });
  });
});
