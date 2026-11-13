import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist/frontend',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Claude Directory Scraper: forwards /proxy/... to the Anthropic directory API (dev only)
      '/proxy': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy/, ''),
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        timeout: 60000,
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
