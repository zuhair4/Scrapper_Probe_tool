import express from 'express';
import cors from 'cors';
import { ProbeRequestSchema, executeProbe } from './probe/executeProbe.js';
import { ZodError } from 'zod';
import { chatgptRouter } from './chatgpt/pluginStoreRouter.js';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST', 'OPTIONS'],
  })
);
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

app.listen(PORT, () => {
  console.log(`MCP Auth Discovery Probe server on http://localhost:${PORT}`);
});
