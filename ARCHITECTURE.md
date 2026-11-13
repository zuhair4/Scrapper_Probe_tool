# Architecture

MCP Toolkit is a browser app plus a small local API server. Three tools share one shell:

| Tool | Route | What it does |
|---|---|---|
| Home | `/` | Landing page: what each tool does and how to use them together. |
| Claude Directory Scraper | `/claude` (old `/scraper` links redirect here) | Pages Anthropic's public directory API, classifies each entry (Connector / Plugin / Extension), searches, saves, exports CSV, builds a report, sends endpoints to the Probe. |
| ChatGPT Plugin Scraper | `/chatgpt` | Reads a HAR captured in the user's own browser (the category lists), or, as an in-development alternative, **Fetch live** calls home and every category through the local server; either way it then fetches every plugin's details through the local server. Same save, export, report and Send to Probe. |
| OAuth Discovery Probe | `/probe`, results at `/search/results/report/<runId>` | Probes MCP endpoints for OAuth discovery (challenge, protected resource metadata, authorization server metadata, one registration check), classifies them, saves runs, exports CSV, builds a report. |

Stack: React 18, TypeScript and Tailwind on Vite; Express and zod for the API; Vitest for tests. There is no database and no login. The server keeps no state. Everything a user keeps is saved in their own browser (IndexedDB), and only when they ask. The app needs no API keys, tokens, cookies or `.env` file; the only environment variables the code reads are `PORT` and the optional `HTTPS_PROXY` / `HTTP_PROXY` (ChatGPT calls behind a corporate proxy).

## Technology and libraries

Versions are the ranges in `package.json`. Only five packages are runtime dependencies (second table); everything else is a dev dependency used at build or test time.

| Area | Technology | Role |
|---|---|---|
| Language | TypeScript 5 (strict) | Both halves. Backend compiles with `tsc` (NodeNext, ES2022); frontend is type-checked and bundled by Vite |
| Runtime | Node.js 18+ | Express server; uses the built-in `fetch` for probe requests |
| Frontend framework | React 18, `react-dom` | UI. No router or state library: a History-API router and plain React state live in `App.tsx` |
| Build tool | Vite 5, `@vitejs/plugin-react` | Dev server (:5173), production bundle, dev-only `/proxy` to Anthropic |
| Styling | Tailwind CSS 3, PostCSS, Autoprefixer | TeamZ palette (`dl.*`), layout |
| Fonts | Web Fonts (browser, at run time) | Open Sans and JetBrains Mono in the app; Bricolage Grotesque and Figtree in the report templates |
| Backend framework | Express 4 | `/api/probe`, `/api/health`, `/api/chatgpt/*` |
| Validation | zod 3 | `ProbeRequestSchema` |
| CORS | `cors` | Dev client origin only |
| Browser storage | IndexedDB, wrapped by `shared/idb.ts` | Saved scrapes and probe runs. No ORM or library |
| CSV | In-house RFC 4180 reader (`shared/csv.ts`) and writers | Upload and export. No CSV library |
| Reports | Static HTML templates with their own CSS and script | No chart or UI library; data is inlined as JSON |
| ChatGPT upstream | System `curl` binary via `child_process.execFile` | Keeps a browser-like TLS fingerprint for chatgpt.com calls |
| Dev tooling | `tsx`, `concurrently` | Run and watch the server; run both halves with `npm run dev` |
| Testing | Vitest 1, `fake-indexeddb` | Node environment; IndexedDB faked for the history tests |
| Types | `@types/node`, `@types/express`, `@types/cors`, `@types/react`, `@types/react-dom` | Typings only |

| Package | Kind |
|---|---|
| `express`, `cors`, `zod` | Runtime (server) |
| `react`, `react-dom` | Runtime (bundled into the client) |
| `vite`, `@vitejs/plugin-react`, `tailwindcss`, `postcss`, `autoprefixer`, `typescript`, `tsx`, `concurrently`, `vitest`, `fake-indexeddb`, `@types/*` | Dev |

## Run and build

| Command | Does |
|---|---|
| `npm run dev` | Starts both: API on `:3001` (`tsx watch backend/src/index.ts`) and the Vite client on `:5173` (`vite frontend`). |
| `npm run dev:server` / `npm run dev:client` | Either half on its own. |
| `npm test` | `vitest run` (`frontend/tests/**/*.test.ts` and `backend/tests/**/*.test.ts`, Node environment). Run from the repo root. |
| `npm run build` | `tsc -p backend/tsconfig.json` (backend to `dist/backend`), then `vite build frontend` (client to `dist/frontend`). |

## 1. Runtime picture

```
 Browser, localhost:5173 (React app)
   |
   |  /proxy/api/directory/plugins --> Vite dev proxy --> https://api.anthropic.com        Claude scraper
   |  POST /api/probe              --> Vite dev proxy --> Express :3001 --> MCP endpoint,   Probe
   |                                                      (SSRF-checked)    its auth servers
   |  /api/chatgpt/*               --> Vite dev proxy --> Express :3001 --> chatgpt.com     ChatGPT scraper
   |                                                                        /backend-api/ps (plugin details only)
   |
   |  IndexedDB (this browser only):  directory-scraper | chatgpt-scraper | probe-history
   |
   +- the user's own signed-in chatgpt.com tab
        chatgpt-scraper/capture-chatgpt-har.js  -->  .har file  -->  uploaded on /chatgpt
```

- `/proxy` exists only in the Vite dev server (`frontend/vite.config.ts`). `/api` is proxied to the Express server.
- chatgpt.com answers server-side requests for its category lists with a Cloudflare challenge, so the dependable route is to capture those lists in the user's own browser and upload them. **Fetch live** (in development) tries the same calls through the server and stops at the first refusal, pointing back at the capture.

## 2. Directory structure

One `package.json` at the root serves both halves. `frontend/` is everything that runs in the browser; `backend/` is the Express API. Neither imports from the other: they meet only over HTTP (`/api/*`).

```
.
├── README.md                      Run steps and the daily ChatGPT capture steps
├── ARCHITECTURE.md                This file
├── package.json, package-lock.json   Dependencies and scripts for both halves
├── vitest.config.ts               Node environment; runs frontend/tests and backend/tests
├── connectors-without-probeable-url.csv   Sample export from the Claude page; nothing reads it
├── .gitignore                     node_modules, dist, .env*, logs, *.har, .data/
│
├── frontend/                      Browser app: React, TypeScript, Tailwind, built by Vite
│   ├── index.html                 Vite entry: fonts, #root, loads src/main.tsx
│   ├── vite.config.ts             Dev server :5173; proxies /proxy (Anthropic) and /api (Express :3001); build to dist/frontend
│   ├── tsconfig.json              Client + frontend tests (bundler resolution, noEmit)
│   ├── tailwind.config.js         TeamZ palette (dl.*), Open Sans and JetBrains Mono
│   ├── postcss.config.js
│   ├── public/
│   │   ├── teamz-logo.svg         Nav logo, SVG icon fallback, Apple touch icon
│   │   └── favicon.svg            Browser tab icon
│   │
│   ├── src/
│   │   ├── main.tsx               React root (StrictMode), imports index.css
│   │   ├── index.css              Tailwind layers and base styles
│   │   ├── vite-env.d.ts          Vite client types (?raw imports)
│   │   ├── App.tsx                Shell: History-API router, nav, probe run orchestration, probe history, Send to Probe
│   │   │
│   │   ├── features/              One folder per tool
│   │   │   ├── landing/
│   │   │   │   └── LandingPage.tsx          Home: tool cards and the "How to use" flow diagram
│   │   │   │
│   │   │   ├── probe/                       OAuth Discovery Probe
│   │   │   │   ├── components/
│   │   │   │   │   ├── ProbeInputPage.tsx     Probe input: paste endpoints or upload a CSV (column picker, preview)
│   │   │   │   │   ├── ProbeRunView.tsx       A run's page: progress, results, save, re-run, export, report
│   │   │   │   │   ├── ProbeResultsTable.tsx  One row per endpoint (Category column when any has one)
│   │   │   │   │   ├── ProbeDetailDrawer.tsx  Every request and response of one endpoint, with a curl for each
│   │   │   │   │   ├── ProbeExportButtons.tsx Download the run as CSV
│   │   │   │   │   └── ProbeHistoryPanel.tsx  Saved probes list
│   │   │   │   └── lib/                       Probe logic (no React)
│   │   │   │       ├── probeTypes.ts          Shared types: EndpointResult, RunState, RunSettings, ClassificationResult, Fetcher...
│   │   │   │       ├── discovery.ts           The probe algorithm (discoverEndpoint) and its steps
│   │   │   │       ├── classify.ts            Turns PRM/AS metadata into a ClassificationResult; edge-block, API-key and provider detection
│   │   │   │       ├── summary.ts             dcrState, isCimd, summarize (counts for a run)
│   │   │   │       ├── appName.ts             deriveAppName / displayName: the name shown for an endpoint
│   │   │   │       ├── details.ts             One-line summaries of response bodies, for the CSV
│   │   │   │       ├── curl.ts                generateCurl for the detail drawer
│   │   │   │       ├── exportCsv.ts           Probe results to CSV (same columns as the table)
│   │   │   │       ├── probeCsv.ts            CSV to endpoints (+ taxonomy category) for the Probe's Upload CSV
│   │   │   │       └── probeHistoryDb.ts      Saved probe runs (IndexedDB 'probe-history'); one-time move from old localStorage
│   │   │   │
│   │   │   ├── claude-scraper/              Claude Directory Scraper
│   │   │   │   ├── claudeDirectory.ts       Item type, classify (Connector/Plugin/Extension), taxonomy helpers, fetchPage, buildCSV, Send to Probe helpers
│   │   │   │   ├── ClaudeScraperPage.tsx    The page: fetch all pages, tabs, search, pagination, save, report, export, Send to Probe
│   │   │   │   ├── ClaudeScraperModals.tsx  Shell (modal frame), ItemModal, HistoryModal, CatBadge
│   │   │   │   └── claudeHistoryDb.ts       Saved scrapes (IndexedDB 'directory-scraper')
│   │   │   │
│   │   │   ├── chatgpt-scraper/             ChatGPT Plugin Scraper
│   │   │   │   ├── pluginStore.ts           Parsing and building: HAR/home/category/detail to PsPlugin, MCP server parsing, CSV builders, probeLinesOf
│   │   │   │   ├── liveCategory.ts          Fetch live: reads every page of one category through the backend, learning which query parameter carries the continuation
│   │   │   │   ├── chatgptApi.ts            Calls to /api/chatgpt/* with readable errors (exports `backendApi`)
│   │   │   │   ├── ChatGPTScraperPage.tsx   The page: upload HAR or Fetch live, fetch details in batches, filters, pagination, save, export, Send to Probe
│   │   │   │   ├── chatgptHistoryDb.ts      Saved scrapes (IndexedDB 'chatgpt-scraper')
│   │   │   │   ├── ChatGPTHistoryModal.tsx  Saved scrapes dialog (reuses Shell from claude-scraper/ClaudeScraperModals)
│   │   │   │   └── capture-chatgpt-har.js   Pasted into the console of a signed-in chatgpt.com tab; downloads a dated .har.
│   │   │   │                                Also bundled into the ChatGPT page (?raw) for its "Copy capture script" button.
│   │   │   │
│   │   │   └── reports/                     Self-contained HTML reports
│   │   │       ├── fillReportTemplate.ts    PLACEHOLDER, safeJson, fillTemplate, reportFileName
│   │   │       ├── openReport.ts            Opens a built report in a new tab (falls back to a download)
│   │   │       ├── buildClaudeReportData.ts Claude scrape to the dashboard's data object; categoryOf
│   │   │       ├── generateClaudeReport.ts  buildClaudeReportData + claudeReportTemplate.html -> HTML
│   │   │       ├── claudeReportTemplate.html  Claude connector dashboard (one file: markup, CSS, script)
│   │   │       ├── buildChatGPTReportData.ts  ChatGPT scrape to the dashboard's data object (status, categories, auth, developers, created months)
│   │   │       ├── generateChatGPTReport.ts buildChatGPTReportData + chatgptReportTemplate.html -> HTML
│   │   │       ├── chatgptReportTemplate.html ChatGPT plugin dashboard (one file)
│   │   │       ├── buildProbeReportData.ts  Probe run to the dashboard's data object; joins to a scrape when one is available
│   │   │       ├── generateProbeReport.ts   buildProbeReportData + probeReportTemplate.html -> HTML
│   │   │       └── probeReportTemplate.html Probe dashboard (one file)
│   │   │
│   │   └── shared/                Used by more than one feature (no React)
│   │       ├── csv.ts             parseCsv: RFC 4180 reader
│   │       ├── idb.ts             createStore: minimal IndexedDB helper
│   │       └── history.ts         keepNewest / dropOldest: the "newest N" rule shared by all histories
│   │
│   └── tests/                     One file per module under test (see section 7)
│
└── backend/                       Express API (Node, ES modules; imports use the .js suffix)
    ├── tsconfig.json              Backend build (NodeNext, rootDir src, outDir ../dist/backend)
    ├── src/
    │   ├── index.ts               App setup, CORS (localhost:5173 only), routes: POST /api/probe, GET /api/health, /api/chatgpt/*
    │   ├── probe/
    │   │   ├── executeProbe.ts    ProbeRequestSchema (zod) and executeProbe: header allow-list, manual redirects (max 3), 256 KB body cap, timeout
    │   │   ├── ssrf.ts            checkSSRF: resolves DNS and refuses private, loopback and link-local addresses; run on every hop
    │   │   └── rateLimit.ts       acquireHostLock: one request at a time per host, with a minimum gap
    │   └── chatgpt/
    │       └── pluginStoreRouter.ts   Router for chatgpt.com plugin data: GET /home, GET /category/:slug, GET /plugin/:id, POST /plugins/batch. Loopback only, paced at 8 requests a second
    └── tests/
```

## 3. How the files connect

### 3.1 Layers

Imports point downward. Nothing lower imports anything above it, with the exceptions listed in section 8. Paths are relative to `frontend/src/features/` unless prefixed `shared/` or `backend/`.

```
 pages        App.tsx
                +-- claude-scraper/ClaudeScraperPage     chatgpt-scraper/ChatGPTScraperPage
                +-- landing/LandingPage    probe/components/{ProbeInputPage, ProbeRunView, ProbeHistoryPanel}
                                                                           |
 components                                          ProbeRunView -> ProbeResultsTable, ProbeDetailDrawer, ProbeExportButtons
                                                     claude-scraper/ClaudeScraperModals (Shell, ItemModal, HistoryModal): used by both scraper pages and ProbeHistoryPanel
                                                                           |
 logic        probe/lib/discovery -> probe/lib/classify, probe/lib/appName
              probe/lib/{summary, details, curl, exportCsv, probeCsv -> shared/csv}
              claude-scraper/claudeDirectory      chatgpt-scraper/pluginStore      chatgpt-scraper/chatgptApi -> pluginStore
              reports/build*Data, reports/generate*, reports/fillReportTemplate, reports/openReport
                                                                           |
 storage      claude-scraper/claudeHistoryDb   chatgpt-scraper/chatgptHistoryDb   probe/lib/probeHistoryDb   -> shared/idb, shared/history
                                                                           |
 types        probe/lib/probeTypes
```

### 3.2 What each file imports

Generated from the actual imports. Internal imports only (packages and CSS are left out). Paths are relative to `frontend/src/` with the `features/` part dropped, or, for the backend, to `backend/src/`.

| File | Imports |
|---|---|
| `backend/chatgpt/pluginStoreRouter` | nothing |
| `backend/index` | `backend/probe/executeProbe`, `backend/chatgpt/pluginStoreRouter` |
| `backend/probe/executeProbe` | `backend/probe/ssrf`, `backend/probe/rateLimit` |
| `backend/probe/rateLimit` | nothing |
| `backend/probe/ssrf` | nothing |
| `App` | `probe/components/ProbeInputPage`, `probe/components/ProbeRunView`, `probe/components/ProbeHistoryPanel`, `landing/LandingPage`, `claude-scraper/ClaudeScraperPage`, `chatgpt-scraper/ChatGPTScraperPage`, `probe/lib/discovery`, `probe/lib/classify`, `probe/lib/probeTypes`, `probe/lib/probeHistoryDb`, `probe/lib/appName` |
| `chatgpt-scraper/ChatGPTHistoryModal` | `claude-scraper/ClaudeScraperModals`, `claude-scraper/claudeDirectory`, `chatgpt-scraper/chatgptHistoryDb` |
| `chatgpt-scraper/ChatGPTScraperPage` | `chatgpt-scraper/chatgptApi`, `chatgpt-scraper/pluginStore`, `chatgpt-scraper/liveCategory`, `chatgpt-scraper/chatgptHistoryDb`, `chatgpt-scraper/ChatGPTHistoryModal`, `claude-scraper/claudeDirectory`, `reports/generateChatGPTReport`, `reports/openReport`, `chatgpt-scraper/capture-chatgpt-har.js (?raw)` |
| `chatgpt-scraper/chatgptApi` | `chatgpt-scraper/pluginStore` |
| `chatgpt-scraper/chatgptHistoryDb` | `chatgpt-scraper/pluginStore`, `shared/history`, `shared/idb` |
| `chatgpt-scraper/liveCategory` | `chatgpt-scraper/pluginStore` |
| `chatgpt-scraper/pluginStore` | nothing |
| `claude-scraper/ClaudeScraperModals` | `claude-scraper/claudeDirectory`, `claude-scraper/claudeHistoryDb` |
| `claude-scraper/ClaudeScraperPage` | `claude-scraper/claudeDirectory`, `claude-scraper/claudeHistoryDb`, `claude-scraper/ClaudeScraperModals`, `reports/generateClaudeReport`, `reports/fillReportTemplate`, `reports/openReport` |
| `claude-scraper/claudeDirectory` | nothing |
| `claude-scraper/claudeHistoryDb` | `claude-scraper/claudeDirectory`, `shared/history`, `shared/idb` |
| `landing/LandingPage` | nothing |
| `probe/components/ProbeDetailDrawer` | `probe/lib/curl`, `probe/components/ProbeResultsTable`, `probe/lib/appName`, `probe/lib/probeTypes` |
| `probe/components/ProbeExportButtons` | `probe/lib/exportCsv`, `probe/lib/probeTypes` |
| `probe/components/ProbeHistoryPanel` | `probe/lib/appName`, `probe/lib/summary`, `claude-scraper/ClaudeScraperModals`, `probe/lib/probeTypes` |
| `probe/components/ProbeInputPage` | `probe/lib/probeTypes`, `App`, `probe/lib/probeCsv` |
| `probe/components/ProbeResultsTable` | `probe/lib/probeTypes`, `probe/lib/summary`, `probe/lib/appName`, `probe/lib/probeCsv` |
| `probe/components/ProbeRunView` | `probe/components/ProbeResultsTable`, `probe/components/ProbeDetailDrawer`, `probe/components/ProbeExportButtons`, `probe/lib/summary`, `probe/lib/appName`, `reports/openReport`, `reports/generateProbeReport`, `claude-scraper/claudeHistoryDb`, `claude-scraper/claudeDirectory`, `probe/lib/probeTypes` |
| `probe/lib/appName` | `probe/lib/probeTypes` |
| `probe/lib/classify` | `probe/lib/probeTypes` |
| `probe/lib/curl` | `probe/lib/probeTypes` |
| `probe/lib/details` | `probe/lib/probeTypes` |
| `probe/lib/discovery` | `probe/lib/probeTypes`, `probe/lib/classify`, `probe/lib/appName` |
| `probe/lib/exportCsv` | `probe/lib/probeTypes`, `probe/lib/summary`, `probe/lib/appName`, `probe/lib/details`, `probe/components/ProbeResultsTable` |
| `probe/lib/probeCsv` | `shared/csv` |
| `probe/lib/probeHistoryDb` | `probe/lib/probeTypes`, `shared/idb`, `shared/history` |
| `probe/lib/probeTypes` | nothing |
| `probe/lib/summary` | `probe/lib/probeTypes` |
| `reports/buildChatGPTReportData` | `chatgpt-scraper/pluginStore` |
| `reports/buildClaudeReportData` | `claude-scraper/claudeDirectory` |
| `reports/buildProbeReportData` | `claude-scraper/claudeDirectory`, `reports/buildClaudeReportData`, `probe/lib/summary`, `probe/lib/appName`, `probe/lib/probeTypes` |
| `reports/fillReportTemplate` | nothing |
| `reports/generateChatGPTReport` | `reports/chatgptReportTemplate.html (?raw)`, `reports/buildChatGPTReportData`, `reports/fillReportTemplate`, `chatgpt-scraper/pluginStore` |
| `reports/generateClaudeReport` | `reports/claudeReportTemplate.html (?raw)`, `reports/buildClaudeReportData`, `reports/fillReportTemplate`, `claude-scraper/claudeDirectory` |
| `reports/generateProbeReport` | `reports/probeReportTemplate.html (?raw)`, `reports/buildProbeReportData`, `reports/fillReportTemplate`, `claude-scraper/claudeDirectory`, `probe/lib/probeTypes` |
| `reports/openReport` | nothing |
| `main` | `App`, `index.css` |
| `shared/csv` | nothing |
| `shared/history` | nothing |
| `shared/idb` | nothing |

### 3.3 Who depends on the shared modules

Modules imported by three or more files.

| Module | Imported by |
|---|---|
| `probe/lib/probeTypes` | `App`, `probe/components/ProbeDetailDrawer`, `probe/components/ProbeExportButtons`, `probe/components/ProbeHistoryPanel`, `probe/components/ProbeInputPage`, `probe/components/ProbeResultsTable`, `probe/components/ProbeRunView`, `probe/lib/appName`, `probe/lib/classify`, `probe/lib/curl`, `probe/lib/details`, `probe/lib/discovery`, `probe/lib/exportCsv`, `probe/lib/probeHistoryDb`, `probe/lib/summary`, `reports/buildProbeReportData`, `reports/generateProbeReport` |
| `claude-scraper/claudeDirectory` | `chatgpt-scraper/ChatGPTHistoryModal`, `chatgpt-scraper/ChatGPTScraperPage`, `claude-scraper/ClaudeScraperModals`, `claude-scraper/ClaudeScraperPage`, `claude-scraper/claudeHistoryDb`, `probe/components/ProbeRunView`, `reports/buildClaudeReportData`, `reports/buildProbeReportData`, `reports/generateClaudeReport`, `reports/generateProbeReport` |
| `probe/lib/appName` | `App`, `probe/components/ProbeDetailDrawer`, `probe/components/ProbeHistoryPanel`, `probe/components/ProbeResultsTable`, `probe/components/ProbeRunView`, `probe/lib/discovery`, `probe/lib/exportCsv`, `reports/buildProbeReportData` |
| `probe/lib/summary` | `probe/components/ProbeHistoryPanel`, `probe/components/ProbeResultsTable`, `probe/components/ProbeRunView`, `probe/lib/exportCsv`, `reports/buildProbeReportData` |
| `chatgpt-scraper/pluginStore` | `chatgpt-scraper/ChatGPTScraperPage`, `chatgpt-scraper/chatgptApi`, `chatgpt-scraper/chatgptHistoryDb`, `chatgpt-scraper/liveCategory`, `reports/buildChatGPTReportData`, `reports/generateChatGPTReport` |
| `claude-scraper/ClaudeScraperModals` | `chatgpt-scraper/ChatGPTHistoryModal`, `claude-scraper/ClaudeScraperPage`, `probe/components/ProbeHistoryPanel` |
| `claude-scraper/claudeHistoryDb` | `claude-scraper/ClaudeScraperModals`, `claude-scraper/ClaudeScraperPage`, `probe/components/ProbeRunView` |
| `probe/components/ProbeResultsTable` | `probe/components/ProbeDetailDrawer`, `probe/components/ProbeRunView`, `probe/lib/exportCsv` |
| `reports/fillReportTemplate` | `claude-scraper/ClaudeScraperPage`, `reports/generateChatGPTReport`, `reports/generateClaudeReport`, `reports/generateProbeReport` |
| `shared/history` | `chatgpt-scraper/chatgptHistoryDb`, `claude-scraper/claudeHistoryDb`, `probe/lib/probeHistoryDb` |
| `shared/idb` | `chatgpt-scraper/chatgptHistoryDb`, `claude-scraper/claudeHistoryDb`, `probe/lib/probeHistoryDb` |

### 3.4 Data flows

**Claude: scrape to report.** `ScraperPage` calls `fetchPage` (`claude-scraper/claudeDirectory`) for `/proxy/api/directory/plugins?...`, page after page, until there is no `next_page`. Items are classified (`classify`) and shown by tab, search and pagination. **Save scrape** writes them to `claude-scraper/claudeHistoryDb`. **Generate report** runs `generateReport` -> `buildReportData` -> `fillTemplate(template.html)` and `openReport` opens it in a new tab. The page also publishes its current items to `App` (`onDirectoryChange`) so a probe report can join to them.

**ChatGPT: capture to table.**
1. In the user's signed-in tab, `chatgpt-scraper/capture-chatgpt-har.js` reads the home list and every category and downloads a HAR (responses only, no cookies or headers).
2. **Upload HAR** on `/chatgpt` parses it with `pluginStore.ingestImported` -> `ingestHar` (`ingestHome` for category titles, `ingestCategoryPage` for each full list). Plugins are merged by id, so one plugin can carry several categories.
3. Details are fetched in batches of 20, five batches at a time: `backendApi.detailBatch` -> `POST /api/chatgpt/plugins/batch` -> `chatgptRouter` -> `chatgpt.com/backend-api/ps/plugins/:id`. Each answer goes through `applyDetail` (`normalizePlugin`, `parseMcpServers`, `classifyMcp`) and the table updates as batches land.
**ChatGPT: Fetch live (in development).** Instead of steps 1-2, the **Fetch live** button runs the same three calls from the page, one after the other: `backendApi.home` (`ingestHome`), then for each category `liveCategory.readCategory` -> `backendApi.categoryPage` -> `GET /api/chatgpt/category/:slug` (`ingestCategoryPage`; follows the continuation value, trying the allowed parameter names once and remembering the one that works), then the details of step 3. A 401, 403 or 429 stops the run at once, keeps what was read and says to use the capture script instead; a category that fails on its own is marked as having only its home list. The HAR route is unchanged.

4. Save, export (`buildPsCsv`, `buildMcpEndpointsCsv`) and Send to Probe (`probeLinesOf`) work on the plugins in memory.

**Send to Probe and CSV upload.** All routes end in `App`'s state:
- Claude page: `probeSendFor` (`claude-scraper/claudeDirectory`) returns `url | name` lines plus each URL's taxonomy category.
- ChatGPT page: `probeLinesOf` (`pluginStore.ts`) returns lines only (ChatGPT's categories are not the taxonomy the report uses).
- Probe page: **Upload CSV** (`InputPage`) -> `readCsv`, `guessColumns`, `endpointsFromCsv` (`probe/lib/probeCsv`).

`App.sendToProbe` appends the lines to `probeText` (skipping URLs already there) and merges categories into `probeCategories` (a map keyed by URL). `InputPage` reads both and hands `{url, label, category}` to `App.startRun`.

**Probe run.**
1. `App.startRun` creates a pending `EndpointResult` per input (carrying `label` and `category`) and runs 8 workers over the queue.
2. Each worker calls `discoverEndpoint` (`probe/lib/discovery`) with `proxyFetcher`, which POSTs each request to `/api/probe`.
3. The server (`executeProbe.ts`) checks SSRF on every hop, filters headers, follows at most 3 redirects, caps the body at 256 KB, and serialises requests per host (`rateLimit.ts`).
4. `discoverEndpoint` steps: challenge probe (an MCP `initialize` POST, then GET requests) -> protected resource metadata (candidates, `resource_metadata` from `WWW-Authenticate`) -> authorization server metadata per issuer (falls back to the endpoint's origin) -> one automatic registration probe if a `registration_endpoint` exists -> `classifyEndpoint`. Extra registration variants (A to F) run only if `dcrEnabled` and `dcrConfirmed` are set; the UI uses the defaults, which leave them off.
5. Each result replaces its pending row (`id` and `category` are kept). `RunView` shows them as they land; the run lives in a ref and is mirrored into state, so StrictMode cannot start it twice.
6. **Save probe** writes the run to `probe/lib/probeHistoryDb`. **Export CSV** is `probe/lib/exportCsv`. **Generate report** is `generateProbeReport` (below).

**Probe report and the Claude scrape.** `RunView` builds the report from the run plus a directory when one exists: the open scrape (`getDirectory()`), else the newest saved scrape (`claude-scraper/claudeHistoryDb`), else none. `buildProbeReportData` joins endpoints to Claude connectors by URL, then by name, to add tier, launch month and the directory's own category. Without a scrape the report still shows categories if the endpoints were loaded with one (CSV or Send to Probe from Claude).

**Category.** A string `level:value` (`dept`, `industry`, `object` or `life`, then the taxonomy value, e.g. `dept:design`). It is created from the taxonomy: `claude-scraper/claudeDirectory.categoryForItem` for the Claude page, `probe/lib/probeCsv.categoryKey` for a CSV (the `taxonomy_category` column; the plain `category` column is ignored). It travels as `EndpointInput.category` -> `EndpointResult.category`, so it is saved with the run and used by `ResultsTable`, `exportCsv` and `buildProbeReportData`.

## 4. Backend

| Route | Handler | Notes |
|---|---|---|
| `POST /api/probe` | `backend/src/index.ts` -> `executeProbe.ts` | Body limit 16 KB, zod-validated. Logs the method and URL only, never bodies. Failures come back as `status: 0` responses, not exceptions. |
| `GET /api/health` | `backend/src/index.ts` | `{ ok, ts }`. |
| `GET /api/chatgpt/home` | `pluginStoreRouter.ts` | Proxies `/backend-api/ps/plugins/home` (with the extra header the plugins page sends). Used by Fetch live. |
| `GET /api/chatgpt/category/:slug` | `pluginStoreRouter.ts` | One page of `/backend-api/ps/plugin-categories/:slug/plugins?scope=GLOBAL&limit=100`. Optional `param` (one of seven allowed names) and `cursor` (plain token characters) continue from the previous page. Used by Fetch live. |
| `GET /api/chatgpt/plugin/:id` | `pluginStoreRouter.ts` | One plugin's details. Id must match `[A-Za-z0-9_~-]{1,80}`. |
| `POST /api/chatgpt/plugins/batch` | `pluginStoreRouter.ts` | Up to 25 ids, 4 at a time. Stops the batch on 401, 403 or 429 and says so. |

Safeguards:
- **Fixed upstream.** `pluginStoreRouter.ts` only calls `https://chatgpt.com/backend-api/ps`, with fixed headers; it cannot be pointed elsewhere. It spaces requests (8 a second), retries only 5xx, never retries or works around a 401, 403, 429 or Cloudflare challenge, and answers loopback callers only.
- **Probe guard.** `ssrf.ts` rejects private, loopback and link-local addresses (IPv4 and IPv6) after DNS resolution, on the first request and every redirect. Plain http is refused unless `allowHttp` is set. Only allow-listed headers pass (`content-type`, `accept`, `mcp-protocol-version`, `user-agent`); everything else, including cookies and authorization, is dropped.
- **CORS.** Only `http://localhost:5173` and `http://127.0.0.1:5173`.
- `/api/chatgpt` is mounted before the global JSON parser so its own limits apply.

## 5. Storage

Nothing is saved unless the user clicks Save. There are no cookies and no server-side storage.

| Database (IndexedDB) | Stores | Written by | Keeps |
|---|---|---|---|
| `directory-scraper` | `meta`, `data` | `claude-scraper/claudeHistoryDb` | newest 15 Claude scrapes |
| `chatgpt-scraper` | `meta`, `data` | `chatgpt-scraper/chatgptHistoryDb` | newest 10 ChatGPT scrapes (each holds every plugin with its details) |
| `probe-history` | `runs` | `probe/lib/probeHistoryDb` | newest 15 probe runs |

In the two scraper databases, `meta` holds the list entry (date, counts) and `data` holds the payload, so the history list loads without reading whole scrapes. Older probe runs saved in `localStorage` (`mcp-probe-run-history`) are moved into IndexedDB once. Pages warn before a reload or discard if results are unsaved. The `.data/` folder is a leftover from an older version that saved ChatGPT results on the server; it is git-ignored and unused.

## 6. Reports

A report is one HTML file with its data inlined, so it can be opened offline, shared or saved.
1. `build*ReportData` turns a scrape or a probe run into a plain object.
2. `fillTemplate` (`fillReportTemplate.ts`) replaces the `/*__REPORT_DATA__*/null` placeholder in the template with `safeJson(data)`, which escapes `<`, `>`, `&` and line separators so a hostile connector name cannot break out of the script.
3. `openReport` opens a tab inside the click (so pop-up blockers allow it), shows a "Preparing" page, builds the report, and points the tab at a blob URL. If the tab is blocked, the file downloads instead.

The ChatGPT report (**Generate report** on the ChatGPT page) always covers the whole scrape, not the filtered view; a scrape opened from history is dated by when it was saved. It shows MCP endpoint status, categories, how remote endpoints authenticate, developers and plugins by created month, and a searchable table. It needs each plugin's details, so plugins without them are counted as "Details not fetched yet" and the page says so. Header and env values are never in the data (only their names are kept upstream).

Templates (`claudeReportTemplate.html`, `chatgptReportTemplate.html`, `probeReportTemplate.html`) are static pages with their own CSS and script that render `D`, the inlined data. In the probe template, `HAS_DIR` (a directory scrape was joined) gates tiers and launch months; `HAS_CAT` (any endpoint has a category) gates the category views.

## 7. Tests

`vitest run` from the repo root, Node environment, `fake-indexeddb` for the history tests. Frontend tests live in `frontend/tests/`, backend tests in `backend/tests/`.

| Test file | Covers |
|---|---|
| `classify.test.ts` | `probe/lib/classify` |
| `discovery.test.ts` | `probe/lib/discovery` with a mocked `Fetcher` |
| `appName.test.ts` | `probe/lib/appName` (and `discovery`) |
| `summary.test.ts` | `probe/lib/summary` |
| `curl.test.ts` | `probe/lib/curl` |
| `exportCsv.test.ts` | `probe/lib/exportCsv`, `probe/lib/details` |
| `history.test.ts` | `shared/history` |
| `probeHistoryDb.test.ts` | `probe/lib/probeHistoryDb` |
| `probeCsv.test.ts` | `shared/csv`, `probe/lib/probeCsv` |
| `claudeDirectory.test.ts` | `claude-scraper/claudeDirectory` (classify, taxonomy, probe lines and category, CSV) |
| `claudeHistoryDb.test.ts` | `claude-scraper/claudeHistoryDb` |
| `chatgptPluginStore.test.ts` | `chatgpt-scraper/pluginStore` |
| `chatgptHistoryDb.test.ts` | `chatgpt-scraper/chatgptHistoryDb` |
| `chatgptPluginStoreRouter.test.ts` | `backend/src/chatgpt/pluginStoreRouter` with an injected upstream |
| `chatgptLiveCategory.test.ts` | `chatgpt-scraper/liveCategory` (paging, learned parameter, refusals, stop) |
| `ssrf.test.ts` | `backend/src/probe/ssrf` |
| `claudeReport.test.ts` | `reports/buildClaudeReportData`, `fillReportTemplate` |
| `chatgptReport.test.ts` | `reports/buildChatGPTReportData`, `fillReportTemplate`, ChatGPT template placeholder |
| `probeReport.test.ts` | `reports/buildProbeReportData`, probe template data |

Not covered by tests: the React components and pages, `backend/src/probe/executeProbe.ts` and `backend/src/probe/rateLimit.ts` directly, and the capture script. The report templates' browser scripts are checked only by building the data and the HTML around them.

## 8. Couplings worth knowing

- `probe/lib/exportCsv.ts` imports `statusOf` from `probe/components/ProbeResultsTable.tsx`, so a `lib` file depends on a component.
- `probe/components/ProbeInputPage.tsx` imports the type `EndpointInput` from `App.tsx`, while `App` imports `ProbeInputPage` (a type-only cycle).
- The Claude page's helpers are shared: `claude-scraper/claudeDirectory` is used by the ChatGPT page (`fmtDateTime`), all report code (classification, endpoints, taxonomy) and `ProbeRunView`; `claude-scraper/ClaudeScraperModals` supplies the modal frame (`Shell`) to the ChatGPT history dialog and the probe history panel.
- Pages for `/claude` and `/chatgpt` stay mounted (hidden) while another tab is open, so a running fetch and its results survive navigation. The Probe's endpoint text and category map live in `App` for the same reason.
- Claude's Send to Probe sends the first URL of each connector. A CSV upload takes every URL a connector lists (with the host added to the name) unless "Only the first URL" is ticked.
- Claude connectors whose endpoint is "user-provided" (a host or pattern, not a fixed URL) cannot be probed; they are left out of Send to Probe and CSV import, and the Claude page can export them separately.
- Fetch live is in development: chatgpt.com may refuse server-side calls to `home` and the category lists, and the cursor parameter name is a guess that is learned at run time. The HAR route stays the dependable one.

## 9. Where to change things (see also section 10 for hosting)

| To change... | Look at |
|---|---|
| What the probe checks, or its order | `probe/lib/discovery.ts`, then `probe/lib/classify.ts` for how results are labelled |
| Server safeguards (hosts, headers, redirects, size) | `backend/src/probe/executeProbe.ts`, `backend/src/probe/ssrf.ts`, `backend/src/probe/rateLimit.ts` |
| A column in the probe table or CSV | `probe/components/ProbeResultsTable.tsx` and `probe/lib/exportCsv.ts` together (keep their order in step; `frontend/tests/exportCsv.test.ts` pins the CSV) |
| What a CSV upload accepts | `probe/lib/probeCsv.ts` (`ENDPOINT_HEADERS`, `NAME_HEADERS`, `CATEGORY_HEADERS`) |
| Claude directory fields or classification | `claude-scraper/claudeDirectory.ts` |
| How a ChatGPT plugin or its MCP servers are read | `chatgpt-scraper/pluginStore.ts` |
| ChatGPT capture | `chatgpt-scraper/capture-chatgpt-har.js` (and `pluginStore.ingestHar` for how the file is read) |
| A report's content | `reports/build*ReportData.ts` and the matching `*.html` template |
| How many saves are kept | `HISTORY_LIMIT` in the two scraper history modules, `PROBE_HISTORY_LIMIT` in `probe/lib/probeHistoryDb.ts` |
| The home page diagram | `landing/LandingPage.tsx` |
| Brand colours and fonts | `frontend/tailwind.config.js`, `frontend/index.html` (font links) |

## 10. Deployment

**Today the app is local-only.** `npm run dev` runs two servers; there is no Dockerfile, start script or hosting config. `npm run build` produces `dist/backend` (compiled Express) and `dist/frontend` (static bundle), but nothing serves the bundle in production. Hosting it for a team needs these changes first (none are made yet):

| # | Change | Why |
|---|---|---|
| 1 | Serve `dist/frontend` from Express (`express.static`) with a fallback to `index.html` for non-`/api` routes | Only Vite serves the client today. The History-API router needs the fallback for deep links such as `/probe` and `/search/results/report/<id>` |
| 2 | Add a backend route for `/proxy/api/directory/plugins` to `https://api.anthropic.com/api/directory/plugins` (fixed upstream, query string passed through) | `PROXY_BASE` in `claudeDirectory.ts` works only through the Vite dev proxy |
| 3 | Remove or toggle the `localOnly` check in `pluginStoreRouter.ts` | Behind a host's load balancer every request is non-loopback, so `/api/chatgpt/*` would return 403 |
| 4 | Add access control (shared password from an env var, or the platform's login), `trust proxy`, and a rate limit | A public `/api/probe` is an open outbound relay. The SSRF guard blocks private addresses but not abuse of public ones |
| 5 | Add `"start": "node dist/backend/index.js"` and `"engines": { "node": ">=20" }` | Hosts need a start command and Node version |
| 6 | CORS: nothing if one service serves both halves; add the client origin only if they are split | The list is `localhost:5173` only |

Already deployment-ready: `PORT` is read from the environment, `GET /api/health` can serve as the health check, and there is no server state, so one instance is enough (`rateLimit.ts` is in memory).

**Caveats**
- The ChatGPT routes call the system `curl`. Alpine-based images need `apk add curl`. chatgpt.com often challenges datacenter IPs with Cloudflare, so the HAR route's detail fetch may fail from a hosted server; the Claude scraper and Probe are unaffected.
- Saved history is per browser and per site address, so moving to a new URL starts with empty history.
