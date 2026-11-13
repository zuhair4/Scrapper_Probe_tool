import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ProbeRequestSchema, executeProbe } from './probe/executeProbe.js';
import { ZodError } from 'zod';
import { chatgptRouter } from './chatgpt/pluginStoreRouter.js';

const app = express();

// Trust reverse proxy (e.g. Render, Cloudflare, Vercel)
app.set('trust proxy', 1);

// Configure CORS
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, same-origin, server-to-server)
      if (!origin) return callback(null, true);
      if (process.env.NODE_ENV === 'production' || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
  })
);

// Claude Directory Scraper proxy: forwards /proxy/api/directory/plugins to https://api.anthropic.com
app.get('/proxy/*', async (req, res) => {
  try {
    const upstreamPath = req.originalUrl.replace(/^\/proxy/, '');
    const upstreamUrl = new URL(upstreamPath, 'https://api.anthropic.com');

    // Only allow proxying to the Anthropic directory API
    if (!upstreamUrl.pathname.startsWith('/api/directory/plugins')) {
      res.status(403).json({ error: 'Proxy access restricted to Claude directory API' });
      return;
    }

    const upstreamRes = await fetch(upstreamUrl.toString(), {
      headers: {
        accept: 'application/json',
        'user-agent': 'MCP-Claude-Directory-Proxy/1.0',
      },
    });

    res.status(upstreamRes.status);
    const contentType = upstreamRes.headers.get('content-type');
    if (contentType) {
      res.setHeader('content-type', contentType);
    }
    const data = await upstreamRes.text();
    res.send(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[claude proxy error]', msg);
    res.status(502).json({ error: 'Failed to proxy request to Anthropic directory', details: msg });
  }
});

app.use('/api/chatgpt', chatgptRouter());
app.use(express.json({ limit: '16kb' }));

app.post('/api/probe', async (req, res) => {
  try {
    const probeReq = ProbeRequestSchema.parse(req.body);

    console.log(`[probe] ${probeReq.method} ${probeReq.url}`);

    const result = await executeProbe(probeReq);
    res.json(result);
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'Invalid request', details: err.errors });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[probe error]', msg);
    res.status(500).json({ error: msg });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Serve frontend static build when running standalone (e.g. on Render or locally)
// On Vercel, static assets in dist/frontend are served automatically by Vercel's CDN
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = [
  path.resolve(__dirname, '../frontend'),
  path.resolve(__dirname, '../../dist/frontend'),
].find((dir) => fs.existsSync(dir));

if (frontendDir && !process.env.VERCEL) {
  app.use(express.static(frontendDir));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/proxy')) {
      res.status(404).json({ error: 'Not found', status: 404, url: req.url });
      return;
    }
    res.sendFile(path.join(frontendDir, 'index.html'));
  });
}

// Global error handler: ensures any server crash or unhandled error returns formatted JSON with status code
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = (err as { status?: number; statusCode?: number })?.status || (err as { status?: number; statusCode?: number })?.statusCode || 500;
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[Server Error ${status}] ${req.method} ${req.url}:`, msg);
  res.status(status).json({
    error: msg,
    status,
    method: req.method,
    url: req.url,
  });
});

export { app };
export default app;

