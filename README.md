# MCP Toolkit


A browser app plus a small local API server, with three tools in one shell:

- **Claude Directory Scraper** (`/claude`): pages Anthropic's public connector directory, classifies each entry, exports CSV, builds a report.
- **ChatGPT Plugin Scraper** (`/chatgpt`): reads a HAR captured in your own browser (or tries **Fetch live**), then fetches every plugin's details through the local server.
- **OAuth Discovery Probe** (`/probe`): a deterministic probe (no AI calls) for MCP server endpoints. Paste endpoint URLs (one per line, optional `| label`) or upload a CSV, and the app checks the challenge response, Protected Resource Metadata (RFC 9728), Authorization Server metadata (RFC 8414 / OIDC) and one Dynamic Client Registration (RFC 7591) probe, then classifies each endpoint.

No API keys, logins, tokens or `.env` file are needed. The Claude directory is a public endpoint, the ChatGPT capture uses your own signed-in browser tab, and the probe only sends unauthenticated requests.

## Run

```bash
npm install
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:3001 (`POST /api/probe`, `GET /api/health`, `/api/chatgpt/*`)

| Script | Does |
|---|---|
| `npm run dev` | Server and client together (hot reload) |
| `npm run dev:server` / `npm run dev:client` | Either half on its own |
| `npm test` | Vitest, once (`npm run test:watch` to watch) |
| `npm run build` | Compiles the backend to `dist/backend` and the client to `dist/frontend` |

Requires **Node 18 or newer** (the server uses the built-in `fetch`). On a corporate network, set `HTTPS_PROXY` / `HTTP_PROXY` if the ChatGPT calls need a proxy (the only environment variables the code reads, besides `PORT`).

## Technology used

| Layer | Technology | Used for |
|---|---|---|
| Language | **TypeScript 5** (strict) | Frontend and backend |
| Frontend | **React 18** (+ `react-dom`) | UI. No router library: a small History-API router lives in `App.tsx` |
| Build / dev server | **Vite 5** with `@vitejs/plugin-react` | Dev server on :5173, production bundle, dev-only proxy to Anthropic |
| Styling | **Tailwind CSS 3**, **PostCSS**, **Autoprefixer** | TeamZ palette and layout |
| Fonts | Web Fonts: Open Sans, JetBrains Mono (app); Bricolage Grotesque, Figtree (reports) | Loaded from the browser at run time |
| Backend | **Node.js** + **Express 4** | API server on :3001 |
| Validation | **zod 3** | Probe request schema |
| Cross-origin | **cors** | Allows the dev client origin |
| Storage | Browser **IndexedDB** (small in-house helper, `shared/idb.ts`) | Saved scrapes and probe runs. No database or server state |
| Reports | Self-contained HTML templates (own CSS and script, no chart library) | Claude, ChatGPT and Probe dashboards |
| ChatGPT upstream | System **curl** binary (via `child_process.execFile`) | Server-side calls to chatgpt.com |
| Dev tooling | **tsx** (run and watch TypeScript), **concurrently** (run both halves) | `npm run dev` |
| Testing | **Vitest 1**, **fake-indexeddb** | Unit tests, Node environment |
| Type packages | `@types/node`, `@types/express`, `@types/cors`, `@types/react`, `@types/react-dom` | Typings |

Runtime dependencies are only `express`, `cors`, `zod`, `react` and `react-dom`; everything else is a dev dependency used at build time.

## Project layout

```
frontend/   Browser app (React + Vite + Tailwind): src/features/<tool>, src/shared, tests
backend/    Express API (probe proxy, ChatGPT directory proxy): src, tests
```

The two halves share one `package.json` and only talk over HTTP (`/api/*`). See ARCHITECTURE.md for the file-by-file map.

## Saved data

Nothing is saved unless you click Save. Saves live in your own browser (IndexedDB): newest 15 Claude scrapes, 10 ChatGPT scrapes and 15 probe runs. They are tied to the site's address, so a different host or port starts with empty history. Export CSV to keep results anywhere else.

## ChatGPT plugin directory (daily)

chatgpt.com answers server-side requests for the category lists with a Cloudflare challenge, so the lists are captured in your own signed-in browser:

1. On the app's **ChatGPT** page click **Copy capture script** (same code as `frontend/src/features/chatgpt-scraper/capture-chatgpt-har.js`).
2. Open `https://chatgpt.com/plugins` signed in, press F12, paste into the **Console** (type `allow pasting` first if Chrome blocks it) and press Enter. It downloads `chatgpt-plugins-YYYY-MM-DD.har` (no cookies or headers inside; `*.har` is git-ignored).
3. Click **Upload HAR…** on the ChatGPT page. The app then fetches each plugin's details through its backend. Nothing is kept between visits; export CSV/JSON to keep results.

**Fetch live (in development).** The **Fetch live** button on the same page skips the capture: it asks chatgpt.com for the home list, each category and then each plugin through the app's backend, one request after another. chatgpt.com may refuse these server-side requests (a Cloudflare challenge or a sign-in); the run then stops at the first refusal, keeps what it read and says so. Use the capture steps above when that happens.

## Deployment

The app is built to run locally (`npm run dev`). Hosting it for a team needs a few changes first; they are listed in ARCHITECTURE.md section 10.

## Notes

- The nav logo is `frontend/public/teamz-logo.svg` (also used as the SVG fallback and Apple touch icon). The browser tab icon is `frontend/public/favicon.svg`.
