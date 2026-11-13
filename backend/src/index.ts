import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ProbeRequestSchema, executeProbe } from './probe/executeProbe.js';
import { ZodError } from 'zod';
import { chatgptRouter } from './chatgpt/pluginStoreRouter.js';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

// Trust reverse proxy (e.g. Render, Cloudflare)
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

// Serve frontend static build in production (or if dist/frontend exists)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = [
  path.resolve(__dirname, '../frontend'),
  path.resolve(__dirname, '../../dist/frontend'),
].find((dir) => fs.existsSync(dir));

if (frontendDir) {
  app.use(express.static(frontendDir));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/proxy')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.sendFile(path.join(frontendDir, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`MCP Auth Discovery Probe server on http://localhost:${PORT}`);
});
