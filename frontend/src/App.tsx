import { useCallback, useEffect, useRef, useState } from 'react';
import InputPage from './features/probe/components/ProbeInputPage';
import RunView from './features/probe/components/ProbeRunView';
import HistoryPanel from './features/probe/components/ProbeHistoryPanel';
import Landing from './features/landing/LandingPage';
import ScraperPage from './features/claude-scraper/ClaudeScraperPage';
import ChatGPTScraperPage from './features/chatgpt-scraper/ChatGPTScraperPage';
import type { Directory } from './features/claude-scraper/ClaudeScraperPage';
import { discoverEndpoint, resetDcrCounts } from './features/probe/lib/discovery';
import { classifyEndpoint } from './features/probe/lib/classify';
import { DEFAULT_SETTINGS } from './features/probe/lib/probeTypes';
import {
  PROBE_HISTORY_LIMIT,
  deleteRun as deleteSavedRun,
  listRuns,
  migrateLegacyHistory,
  saveRun as saveRunToDb,
} from './features/probe/lib/probeHistoryDb';
import { probeTitle } from './features/probe/lib/appName';
import type { EndpointResult, Fetcher, ProbeResponse, RunSettings, RunState } from './features/probe/lib/probeTypes';

const HISTORY_MAX = PROBE_HISTORY_LIMIT;
const LEGACY_HISTORY_PATH = '/probe/history'; // history used to be a page; old links just show the probe form
const CONCURRENCY = 8;
const REPORT_PREFIX = '/search/results/report/';
const CLAUDE_PATH = '/claude';
const CLAUDE_PREFIX = `${CLAUDE_PATH}/`;
const LEGACY_SCRAPER_PATH = '/scraper'; // the Claude page used to live here; old links are sent to /claude

export interface EndpointInput {
  url: string;
  label?: string;
  category?: string;
}

// ─── Tiny History-API router ────────────────────────────────────────────────

/** The current location, with an old /scraper link rewritten to /claude (keeping any snapshot id). */
function currentPath(): string {
  const p = window.location.pathname;
  if (p !== LEGACY_SCRAPER_PATH && !p.startsWith(`${LEGACY_SCRAPER_PATH}/`)) return p;
  const to = CLAUDE_PATH + p.slice(LEGACY_SCRAPER_PATH.length);
  window.history.replaceState({}, '', to + window.location.search + window.location.hash);
  return to;
}

function useRouter() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    window.history.pushState({}, '', to);
    setPath(to);
  }, []);
  return { path, navigate };
}

// ─── Backend proxy fetcher ──────────────────────────────────────────────────

function errorResponse(error: string): ProbeResponse {
  return {
    status: 0,
    statusText: 'Error',
    headers: {},
    bodyText: '',
    bodyJson: null,
    contentType: '',
    elapsedMs: 0,
    finalUrl: '',
    redirectHops: [],
    error,
  };
}

/** The probe fetcher for one run. Its signal is aborted when the run is cancelled, which drops the requests in flight. */
const makeProxyFetcher = (signal: AbortSignal): Fetcher => async (req) => {
  if (signal.aborted) return errorResponse('Cancelled');
  try {
    const res = await fetch('/api/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    });
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 300);
      return errorResponse(`[HTTP ${res.status}] POST /api/probe error: ${errText || res.statusText}`);
    }
    return (await res.json()) as ProbeResponse;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorResponse(`[Network Error (HTTP 0)] POST /api/probe failed: ${msg}. Make sure the backend server is running.`);
  }
};

function pendingEndpoint(input: EndpointInput, index: number): EndpointResult {
  const prm = { found: false, resourceMismatch: false };
  const as = { found: false, issuerMismatch: false };
  return {
    id: `pending-${Date.now()}-${index}`,
    label: input.label,
    category: input.category,
    url: input.url,
    startedAt: 0,
    attempts: [],
    prm,
    as,
    classification: classifyEndpoint(prm, as, undefined, false, false, input.url),
    dcrResults: [],
  };
}

// ─── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const { path, navigate } = useRouter();
  // Saved probes (IndexedDB, loaded after the first render). A run still marked "running" in
  // storage was cut off (reload/close), so it is shown as cancelled rather than running forever.
  const [history, setHistory] = useState<RunState[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await migrateLegacyHistory();
        const runs = await listRuns();
        if (!cancelled) setHistory(runs.map((r) => (r.status === 'running' ? { ...r, status: 'cancelled' as const } : r)));
      } catch {
        // storage unavailable: history stays empty, probing still works
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const [activeRun, setActiveRun] = useState<RunState | null>(null);
  const [probeText, setProbeText] = useState('');
  // Category of each endpoint loaded from a CSV, by URL. The endpoint box only holds "url | name" lines.
  const [probeCategories, setProbeCategories] = useState<Record<string, string>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  // The endpoint box starts empty each time the Probe page is opened: leaving the page clears it.
  const prevPath = useRef(path);
  useEffect(() => {
    const isForm = (p: string) => p === '/probe' || p === LEGACY_HISTORY_PATH;
    if (isForm(prevPath.current) && !isForm(path)) {
      setProbeText('');
      setProbeCategories({});
    }
    prevPath.current = path;
  }, [path]);
  // The scraper's current results, read when a probe report is generated (a ref: no re-render per page).
  const directoryRef = useRef<Directory>({ items: [], asOf: null });
  const onDirectoryChange = useCallback((d: Directory) => {
    directoryRef.current = d;
  }, []);

  // Scraper -> Probe: add "url | label" lines to the probe's endpoint box (skipping URLs already there), and keep each
  // URL's taxonomy category so it is saved with the run, exported and used in the report.
  const sendToProbe = useCallback(
    (lines: string[], categories?: Record<string, string>) => {
      if (categories && Object.keys(categories).length > 0) setProbeCategories((prev) => ({ ...prev, ...categories }));
      setProbeText((prev) => {
        const urlOf = (l: string) => /https?:\/\/\S+/i.exec(l)?.[0] ?? l.trim();
        const have = new Set(prev.split(/\r?\n/).map(urlOf));
        const fresh = lines.filter((l) => {
          const u = urlOf(l);
          if (have.has(u)) return false;
          have.add(u); // also drops duplicates within the batch
          return true;
        });
        if (fresh.length === 0) return prev;
        return prev.trim() ? `${prev.replace(/\s+$/, '')}\n${fresh.join('\n')}` : fresh.join('\n');
      });
      navigate('/probe');
    },
    [navigate]
  );
  // Authoritative copy of the running run; state is only a render mirror.
  const runRef = useRef<RunState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const running = activeRun?.status === 'running';

  const update = useCallback((fn: (r: RunState) => RunState) => {
    if (!runRef.current) return;
    runRef.current = fn(runRef.current);
    setActiveRun(runRef.current);
  }, []);

  // Probes are only kept in history when the user clicks Save probe (nothing is saved automatically).
  const saveProbe = useCallback(async () => {
    const run = runRef.current;
    if (!run || run.status === 'running') return;
    try {
      setHistory(await saveRunToDb(run));
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      window.alert(`Could not save this probe (${why}). Use Export CSV to keep the results.`);
    }
  }, []);

  // Leaving the page with a probe that isn't saved loses it, so ask first.
  const activeUnsaved = !!activeRun && !history.some((h) => h.id === activeRun.id);
  useEffect(() => {
    if (!activeUnsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [activeUnsaved]);

  const startRun = useCallback(
    async (inputs: EndpointInput[], settings: RunSettings, label?: string) => {
      if (runRef.current?.status === 'running' || inputs.length === 0) return;
      resetDcrCounts();
      const ctl = new AbortController();
      abortRef.current = ctl;
      const fetcher = makeProxyFetcher(ctl.signal);

      const startedAt = Date.now();
      const endpoints = inputs.map(pendingEndpoint);
      const run: RunState = {
        id: `run-${startedAt}-${Math.random().toString(36).slice(2, 6)}`,
        label: label?.trim() || probeTitle(endpoints),
        startedAt,
        settings,
        endpoints,
        status: 'running',
      };
      runRef.current = run;
      setActiveRun(run);
      navigate(`${REPORT_PREFIX}${run.id}`);

      const queue = [...run.endpoints];
      const worker = async () => {
        while (queue.length > 0 && !ctl.signal.aborted) {
          const ep = queue.shift()!;
          // After a cancel nothing more is written to the run: it was already marked cancelled.
          const patch = (fn: (e: EndpointResult) => EndpointResult) => {
            if (ctl.signal.aborted) return;
            update((r) => ({ ...r, endpoints: r.endpoints.map((e) => (e.id === ep.id ? fn(e) : e)) }));
          };

          patch((e) => ({ ...e, startedAt: Date.now() }));
          let result: EndpointResult;
          try {
            result = await discoverEndpoint(
              ep.url,
              ep.label,
              settings,
              fetcher,
              (a) => patch((e) => ({ ...e, attempts: [...e.attempts, a] }))
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result = {
              ...ep,
              startedAt: Date.now(),
              completedAt: Date.now(),
              error: msg,
              classification: { ...ep.classification, status: 'error', statusNote: msg },
            };
          }
          patch(() => ({ ...result, id: ep.id, category: ep.category }));
        }
      };

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
      if (ctl.signal.aborted) return;
      update((r) => ({ ...r, status: 'complete', completedAt: Date.now() }));
    },
    [navigate, update]
  );

  // Stops at once: requests in flight are dropped, endpoints that were mid-probe go back to pending, and the run is
  // marked cancelled without waiting for the workers to wind down.
  const cancelRun = useCallback(() => {
    abortRef.current?.abort();
    update((r) =>
      r.status !== 'running'
        ? r
        : {
            ...r,
            status: 'cancelled',
            completedAt: Date.now(),
            endpoints: r.endpoints.map((e) => (e.completedAt ? e : { ...e, startedAt: 0, attempts: [] })),
          }
    );
  }, [update]);

  const deleteRun = useCallback(async (id: string) => {
    try {
      setHistory(await deleteSavedRun(id));
    } catch {
      window.alert('Could not delete that probe from this browser.');
    }
  }, []);

  const rerun = useCallback(
    (run: RunState) =>
      // No label passed: a re-run is a new run and gets its own name, not a copy of the old one.
      startRun(
        run.endpoints.map((e) => ({ url: e.url, label: e.label, category: e.category })),
        DEFAULT_SETTINGS
      ),
    [startRun]
  );

  let page: JSX.Element;
  if (path.startsWith(REPORT_PREFIX)) {
    const runId = decodeURIComponent(path.slice(REPORT_PREFIX.length));
    const run = activeRun?.id === runId ? activeRun : history.find((r) => r.id === runId);
    page = !run && !historyLoaded ? (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center text-gray-500">Loading…</div>
    ) : run ? (
      <RunView
        run={run}
        onCancel={cancelRun}
        onRerun={() => rerun(run)}
        busy={!!running}
        historyCount={history.length}
        saved={history.some((h) => h.id === run.id)}
        onSave={saveProbe}
        getDirectory={() => directoryRef.current}
        onNewProbe={() => navigate('/probe')}
        onOpenHistory={() => setHistoryOpen(true)}
      />
    ) : (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h1 className="text-xl font-bold text-[#282728]">Probe not found</h1>
        <p className="text-gray-500 mt-2">
          This probe isn&apos;t in your saved history. Probes are only kept when you click Save probe (the newest {HISTORY_MAX} are kept).
        </p>
        <button onClick={() => navigate('/probe')} className="mt-6 px-4 py-2 rounded bg-[#86BC25] text-white font-semibold hover:bg-[#6a9a1c]">
          New probe
        </button>
      </div>
    );
  } else if (path === '/probe' || path === LEGACY_HISTORY_PATH) {
    page = (
      <InputPage
        text={probeText}
        onTextChange={setProbeText}
        categories={probeCategories}
        onCategoriesChange={setProbeCategories}
        busy={!!running}
        onStart={startRun}
        historyCount={history.length}
        onOpenHistory={() => setHistoryOpen(true)}
      />
    );
  } else if (path === CLAUDE_PATH || path.startsWith(CLAUDE_PREFIX) || path === '/chatgpt') {
    page = <></>; // rendered below so they stay mounted
  } else {
    page = <Landing onNavigate={navigate} />;
  }
  const onScraper = path === CLAUDE_PATH || path.startsWith(CLAUDE_PREFIX);
  const onChatgpt = path === '/chatgpt';
  // If the URL is /claude/{snap-id}, pass that id to ScraperPage so it auto-loads it.
  const scraperSnapId = path.startsWith(CLAUDE_PREFIX) ? decodeURIComponent(path.slice(CLAUDE_PREFIX.length)) : undefined;

  // The Probe tab stays highlighted on its sub-pages (history and run results).
  const onProbe = path.startsWith('/probe') || path.startsWith(REPORT_PREFIX);
  const navLink = (to: string, text: string, active: boolean) => (
    <a
      href={to}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
      className={`text-sm hover:text-white ${active ? 'text-white font-semibold' : 'text-[#9ca3af]'}`}
    >
      {text}
    </a>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header>
        <nav className="bg-[#282728] px-6 h-14 flex items-center gap-8">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
            className="flex items-center gap-3"
          >
            <img src="/teamz-logo.svg" alt="TeamZ" className="h-9 w-9 rounded-md ring-1 ring-white/15" />
            <span className="text-white font-semibold text-lg tracking-tight">MCP Toolkit</span>
          </a>
          <div className="flex items-center gap-6 ml-auto">
            {navLink('/', 'Home', path === '/' || !(onScraper || onProbe || onChatgpt))}
            {navLink(CLAUDE_PATH, 'Claude', onScraper)}
            {navLink('/chatgpt', 'ChatGPT', onChatgpt)}
            {navLink('/probe', 'Probe', onProbe)}
          </div>
        </nav>
        <div className="h-1 bg-[#86BC25]" />
      </header>
      {historyOpen && (
        <HistoryPanel
          runs={history}
          limit={HISTORY_MAX}
          busy={!!running}
          onClose={() => setHistoryOpen(false)}
          onView={(r) => {
            setHistoryOpen(false);
            navigate(`${REPORT_PREFIX}${r.id}`);
          }}
          onRerun={(r) => {
            setHistoryOpen(false);
            rerun(r);
          }}
          onDelete={deleteRun}
        />
      )}
      <main>
        {page}
        {/* Kept mounted so an in-progress scrape survives switching tabs */}
        <div className={onScraper ? '' : 'hidden'}>
          <ScraperPage
            onSendToProbe={sendToProbe}
            onDirectoryChange={onDirectoryChange}
            snapId={scraperSnapId}
            onSnapSaved={(id) => navigate(`${CLAUDE_PREFIX}${id}`)}
          />
        </div>
        <div className={onChatgpt ? '' : 'hidden'}>
          <ChatGPTScraperPage active={onChatgpt} onSendToProbe={sendToProbe} />
        </div>
      </main>
    </div>
  );
}
