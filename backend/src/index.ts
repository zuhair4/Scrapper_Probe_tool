import { app } from './app.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

app.listen(PORT, () => {
  console.log(`MCP Auth Discovery Probe server on http://localhost:${PORT}`);
});
