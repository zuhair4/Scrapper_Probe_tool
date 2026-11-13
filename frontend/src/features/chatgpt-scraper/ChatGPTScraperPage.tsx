import { useEffect, useRef, useState } from 'react';
import { backendApi } from './chatgptApi';
import { MCP_STATUS_LABEL, MCP_STATUS_ORDER, PsHttpError, applyDetail, buildMcpEndpointsCsv, buildPsCsv, ingestHome, ingestImported, probeLinesOf } from './pluginStore';
import type { McpStatus, PsCategory, PsPlugin } from './pluginStore';
import { readCategory } from './liveCategory';
import type { Learned } from './liveCategory';
import { deleteSnapshot, listSnapshots, loadSnapshot, saveSnapshot } from './chatgptHistoryDb';
import type { Cat, SnapshotMeta } from './chatgptHistoryDb';
import HistoryModal from './ChatGPTHistoryModal';
import { fmtDate, fmtDateTime } from '../claude-scraper/claudeDirectory';
import { chatgptReportFileName, generateChatGPTReportHtml } from '../reports/generateChatGPTReport';
import { openReport } from '../reports/openReport';
import captureScript from './capture-chatgpt-har.js?raw';
import { base, Count, Icon, ICONS, look } from '../../shared/toolbar';
import { MultiSelectFilter } from '../../shared/MultiSelectFilter';
import type { FilterOption } from '../../shared/MultiSelectFilter';
import { SortHeader, nextSort } from '../../shared/SortHeader';
import type { SortDir } from '../../shared/SortHeader';

type StepState = 'pending' | 'running' | 'done' | 'skipped' | 'error';
interface Step {
  label: string;
  state: StepState;
  info: string;
}
const INITIAL_STEPS: Step[] = [
  { label: 'Read the category lists', state: 'pending', info: '' },
  { label: 'Fetch each plugin’s details', state: 'pending', info: '' },
];

interface LogLine {
  kind: 'info' | 'ok' | 'warn' | 'err';
  text: string;
  at: string;
}

const PAGE_SIZE = 20;
const isHttp = (u: string) => /^https?:\/\//i.test(u);
const BATCH = 50; // plugin ids per backend call; the backend fetches a few at a time
const PER_SECOND = 8; // the backend starts at most 8 requests a second, however many batches are in flight
const PARALLEL_BATCHES = 5; // batches in flight at once
const CAT_CONCURRENCY = 4; // categories fetched in parallel during live fetch
const errMsg = (e: unknown): string => {
  if (e instanceof PsHttpError) {
    if (e.message.startsWith('[HTTP') || e.message.startsWith('[Network Error')) {
      return e.message;
    }
    const codeTag = e.status === 0 ? '[Network Error (HTTP 0)]' : `[HTTP ${e.status}]`;
    const target = e.method && e.url ? ` ${e.method} ${e.url} -` : '';
    return `${codeTag}${target} ${e.message}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
};

function download(name: string, text: string, type: string) {
  const blob = new Blob([type.startsWith('text/csv') ? String.fromCharCode(0xfeff) + text : text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const LOG_COLOR: Record<LogLine['kind'], string> = { info: 'text-gray-300', ok: 'text-[#a5d65a]', warn: 'text-amber-300', err: 'text-red-300' };

export default function ChatGPTScraperPage({ active, onSendToProbe }: { active: boolean; onSendToProbe: (lines: string[]) => void }) {
  const store = useRef(new Map<string, PsPlugin>());
  const stopRef = useRef(false);
  // Aborted by Stop, which drops the requests in flight so the run ends at once instead of after the current batches.
  const abortRef = useRef<AbortController>(new AbortController());
  const logEnd = useRef<HTMLDivElement>(null);
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);

  const [cats, setCats] = useState<Cat[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [log, setLog] = useState<LogLine[]>([]);
  // What the first stage is doing, and how far through the categories it is (set only while fetching live).
  const [reading, setReading] = useState('Reading the capture…');
  // Set once the capture script is on the clipboard (or shown to copy by hand): the next step is to run it in chatgpt.com.
  const [scriptCopied, setScriptCopied] = useState<'copied' | 'manual' | null>(null);
  const [catProgress, setCatProgress] = useState<{ done: number; total: number } | null>(null);
  // Filters. Empty means all. Ticked categories and endpoint kinds match if a plugin has any of them.
  const [fCats, setFCats] = useState<string[]>([]);
  const [fMcp, setFMcp] = useState<string[]>([]);
  const [fDev, setFDev] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fNoUrl, setFNoUrl] = useState(false);
  // Order of the Added column: '' keeps the order the directory gave. Plugins with no added date always come last.
  const [addedSort, setAddedSort] = useState<SortDir>('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  // Nothing is saved automatically. `savedId` is the history entry that holds the results on screen
  // (also set when a saved scrape is opened from history); `viewing` is that entry while it is open.
  const [savedId, setSavedId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<SnapshotMeta | null>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<SnapshotMeta[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [log.length]);

  const refreshHistory = async () => {
    try {
      setHistory(await listSnapshots());
    } catch {
      setHistoryError('Could not read saved history from this browser.');
    }
  };
  useEffect(() => {
    void refreshHistory();
  }, []);

  // Leaving or reloading with results that are not saved loses them, so ask first.
  const unsaved = store.current.size > 0 && savedId === null && !busy;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  const confirmDiscard = () => !unsaved || window.confirm('These results are not saved and will be lost. Continue without saving?');

  const addLog = (kind: LogLine['kind'], text: string) => setLog((l) => [...l.slice(-300), { kind, text, at: new Date().toLocaleTimeString() }]);
  const setStep = (i: number, patch: Partial<Step>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  // ---- step 2: details, in batches (through the app's backend) ----
  const readDetails = async () => {
    const todo = [...store.current.values()].filter((p) => p.id && !p.hasDetail).map((p) => p.id);
    if (!todo.length) {
      setStep(1, { state: 'done', info: 'every plugin already has its details' });
      addLog('ok', 'Every plugin already has its details.');
      return;
    }
    setStep(1, { state: 'running', info: `0/${todo.length}` });
    addLog('info', `Fetching details for ${todo.length.toLocaleString()} plugins, ${BATCH} per batch (about ${Math.ceil(todo.length / PER_SECOND / 60)} min)…`);
    let failed: string[] = [];
    let batches = 0;

    const runBatch = async (ids: string[]) => {
      let res: Awaited<ReturnType<typeof backendApi.detailBatch>>;
      try {
        res = await backendApi.detailBatch(ids, abortRef.current.signal);
      } catch (e) {
        if (stopRef.current || abortRef.current.signal.aborted) return;
        const errDescription = errMsg(e);
        addLog('warn', `Batch (${ids.length} plugins) failed: ${errDescription}. Retrying batch once...`);
        // Retry once after 1s backoff
        await new Promise((r) => setTimeout(r, 1000));
        if (stopRef.current || abortRef.current.signal.aborted) return;
        try {
          res = await backendApi.detailBatch(ids, abortRef.current.signal);
        } catch (retryErr) {
          if (stopRef.current || abortRef.current.signal.aborted) return;
          console.error('[batch error]', retryErr);
          throw retryErr;
        }
      }
      const { results, blocked } = res;
      for (const r of results) {
        if (r.status === 200) applyDetail(store.current, r.id, r.data);
        else if (r.status !== 0) {
          failed.push(r.id);
          addLog('warn', `Plugin ${r.id} details failed: [HTTP ${r.status}] ${r.error || 'Unknown error'}`);
        }
      }
      if (blocked) throw new Error(blocked);
    };

    // Several batches in flight at once. The backend still paces the requests it sends to chatgpt.com,
    // so this keeps that pace filled instead of waiting for one batch to finish before the next starts.
    const chunks: string[][] = [];
    for (let i = 0; i < todo.length; i += BATCH) chunks.push(todo.slice(i, i + BATCH));
    let next = 0;
    let done = 0;
    let fatal = null as Error | null;
    const worker = async () => {
      while (!stopRef.current && !fatal) {
        const chunk = chunks[next++];
        if (!chunk) return;
        try {
          await runBatch(chunk);
          if (stopRef.current) return;
        } catch (e) {
          fatal = fatal ?? (e instanceof Error ? e : new Error(String(e)));
          return;
        }
        done += chunk.length;
        batches++;
        setStep(1, { info: `${done.toLocaleString()}/${todo.length.toLocaleString()}${failed.length ? ` · ${failed.length} failed` : ''}` });
        refresh();
        if (batches % 10 === 0) addLog('info', `Details: ${done.toLocaleString()}/${todo.length.toLocaleString()}${failed.length ? `, ${failed.length} failed so far` : ''}`);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL_BATCHES }, worker));
    if (fatal) throw fatal;

    if (failed.length && !stopRef.current) {
      addLog('info', `Trying the ${failed.length} failed plugins once more…`);
      const again = failed;
      failed = [];
      for (let i = 0; i < again.length && !stopRef.current; i += BATCH) await runBatch(again.slice(i, i + BATCH));
    }
    const stopped = stopRef.current;
    const fetched = todo.length - failed.length;
    setStep(1, { state: stopped ? 'skipped' : failed.length ? 'error' : 'done', info: stopped ? 'stopped; the details read so far are kept' : `${fetched.toLocaleString()}/${todo.length.toLocaleString()} fetched` });
    addLog(failed.length ? 'warn' : 'ok', stopped ? 'Stopped. The details read so far are kept.' : `Details done: ${fetched.toLocaleString()} fetched${failed.length ? `, ${failed.length} still failing` : ''}`);
  };

  /** Runs one stage with the busy state and error handling shared by the fetch and the import. */
  const run = async (stage: () => Promise<void>) => {
    stopRef.current = false;
    abortRef.current = new AbortController();
    setBusy(true);
    setError(null);
    try {
      await stage();
    } catch (e) {
      addLog('err', errMsg(e));
      setError(errMsg(e));
      setSteps((s) => s.map((x) => (x.state === 'running' ? { ...x, state: 'error' } : x)));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  /** Every fetch or upload starts from nothing, so the page only ever shows what that one run read. */
  const clearAll = () => {
    store.current.clear();
    setCats([]);
    setSteps(INITIAL_STEPS);
    setCatProgress(null);
    setLog([]);
    setFCats([]);
    setFMcp([]);
    setFDev('');
    setFFrom('');
    setFTo('');
    setFNoUrl(false);
    setAddedSort('');
    setQuery('');
    setPage(1);
    setSavedId(null);
    setViewing(null);
    refresh();
  };

  const finish = async () => {
    if (stopRef.current) return;
    await readDetails();
  };

  /**
   * The HAR written by frontend/src/features/chatgpt-scraper/capture-chatgpt-har.js (home plus the full list of every category, read in the
   * user's own browser), then (optionally) each plugin's details through the app's backend.
   */
  const uploadHar = (files: FileList | null) => {
    if (!files?.length || !confirmDiscard()) return;
    setScriptCopied(null);
    const picked = Array.from(files);
    void run(async () => {
      clearAll();
      setReading('Reading the capture…');
      setStep(0, { state: 'running', info: '' });
      addLog('info', `Reading ${picked.map((f) => f.name).join(', ')}…`);
      const home: PsCategory[] = [];
      const full = new Set<string>();
      const notes: string[] = [];
      for (const f of picked) {
        try {
          const r = ingestImported(store.current, JSON.parse(await f.text()), f.name, [...home.map((c) => c.slug), ...full]);
          for (const c of r.cats ?? []) if (!home.some((h) => h.slug === c.slug)) home.push(c);
          for (const s of r.slugs) full.add(s);
          if (!r.plugins && !r.cats?.length) notes.push(`${f.name}: no plugins found in it.`);
        } catch {
          notes.push(`${f.name}: not a JSON or HAR file.`);
        }
      }
      if (!store.current.size) throw new Error(notes.join(' ') || 'No plugins found in the file.');
      const list: Cat[] = home.map((c) => ({ ...c, status: full.has(c.slug) ? 'done' : 'listed' }));
      for (const s of full) if (!list.some((c) => c.slug === s)) list.push({ slug: s, title: s, description: '', teaser: 0, status: 'done' });
      setCats(list);
      const missing = list.filter((c) => c.status === 'listed').map((c) => c.title);
      setStep(0, { state: missing.length ? 'error' : 'done', info: `${list.length} categories · ${store.current.size.toLocaleString()} plugins${missing.length ? ` · ${missing.length} without a full list` : ''}` });
      addLog(missing.length ? 'warn' : 'ok', `${store.current.size.toLocaleString()} unique plugins in ${list.length} categories`);
      if (missing.length) addLog('warn', `No full list in the file for: ${missing.join(', ')}. They keep the home list; run the capture script again.`);
      if (notes.length) setError(notes.join(' '));
      refresh();
      await finish();
    });
  };

  /**
   * In development: the same three calls as the capture script, made one after the other through the app's backend
   * (home, then each category's list, then each plugin's details). chatgpt.com may refuse them (a Cloudflare
   * challenge or a sign-in); the first refusal stops the run and says so. It is never retried or worked around.
   */
  const fetchLive = () => {
    if (!confirmDiscard()) return;
    setScriptCopied(null);
    void run(async () => {
      clearAll();
      setReading('Reading the home list…');
      setStep(0, { state: 'running', info: 'home list' });
      addLog('info', 'Fetching live through the backend: the home list, then each category, then each plugin’s details…');
      const list: Cat[] = [];
      let refused: string | null = null;
      try {
        const home = ingestHome(store.current, await backendApi.home(abortRef.current.signal));
        if (!home.length) throw new Error('The home response had no categories.');
        list.push(...home.map((c): Cat => ({ ...c, status: 'listed' })));
        setCats([...list]);
        addLog('ok', `Home list: ${list.length} categories`);
        refresh();

        const learned: Learned = { param: null };
        let catNext = 0;
        let catDone = 0;
        setReading('Fetching categories…');
        setCatProgress({ done: 0, total: list.length });
        setStep(0, { info: `0/${list.length} categories` });
        const catWorker = async () => {
          while (!stopRef.current && !refused) {
            const i = catNext++;
            if (i >= list.length) return;
            const c = list[i];
            try {
              const r = await readCategory((s, cont) => backendApi.categoryPage(s, cont, abortRef.current.signal), store.current, c.slug, learned, () => stopRef.current);
              list[i] = { ...c, status: r.note ? 'listed' : 'done' };
              catDone++;
              setCatProgress({ done: catDone, total: list.length });
              setStep(0, { info: `${catDone}/${list.length} categories` });
              setCats([...list]);
              addLog(r.note ? 'warn' : 'info', `${c.title}: ${r.plugins.toLocaleString()} plugins in ${r.pages} page${r.pages === 1 ? '' : 's'}${r.note ? ` (${r.note})` : ''}`);
              refresh();
            } catch (e) {
              if (stopRef.current) return;
              refused = errMsg(e) + (e instanceof PsHttpError && e.status >= 400 ? ' Use Copy capture script and Upload HAR file instead.' : '');
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(CAT_CONCURRENCY, list.length) }, catWorker));
      } catch (e) {
        // A refusal (or any failure of the home call): keep what was read so far, and point at the capture script.
        if (!stopRef.current) refused = errMsg(e) + (e instanceof PsHttpError && e.status >= 400 ? ' Use Copy capture script and Upload HAR file instead.' : '');
      }
      setCatProgress(null);
      const partial = list.filter((c) => c.status === 'listed').map((c) => c.title);
      const info = list.length ? `${list.length} categories · ${store.current.size.toLocaleString()} plugins${partial.length ? ` · ${partial.length} without a full list` : ''}` : '';
      if (refused) {
        setStep(0, { state: 'error', info });
        throw new Error(refused);
      }
      if (stopRef.current) {
        setStep(0, { state: 'skipped', info: `stopped; ${info}` });
        return;
      }
      setStep(0, { state: partial.length ? 'error' : 'done', info });
      addLog(partial.length ? 'warn' : 'ok', `${store.current.size.toLocaleString()} unique plugins in ${list.length} categories`);
      await finish();
    });
  };

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(captureScript);
      setScriptCopied('copied');
      addLog('ok', 'Capture script copied. Paste it in the Console of a signed-in chatgpt.com/plugins tab.');
    } catch {
      setScriptCopied('manual');
      window.prompt('Copy the capture script:', captureScript);
    }
  };

  const stop = () => {
    stopRef.current = true;
    abortRef.current.abort();
    addLog('warn', 'Stopping. The plugins and details read so far are kept.');
  };

  const saveScrape = async () => {
    if (saving || busy || !store.current.size || savedId) return;
    setSaving(true);
    setError(null);
    try {
      const rec = await saveSnapshot(cats, [...store.current.values()]);
      setSavedId(rec.id);
      void refreshHistory();
    } catch (e) {
      setError(`Could not save (${errMsg(e)}). Use Export CSV or JSON to keep the results.`);
    } finally {
      setSaving(false);
    }
  };

  const viewSnapshot = async (h: SnapshotMeta) => {
    if (!confirmDiscard()) return;
    setHistoryBusy(true);
    try {
      const snap = await loadSnapshot(h.id);
      if (!snap) throw new Error('empty');
      clearAll();
      for (const p of snap.plugins) store.current.set(p.id || `name:${p.name}`, p);
      setCats(snap.cats);
      setSavedId(h.id); // it came from history, so it is already saved
      setViewing(h);
      setHistoryOpen(false);
      refresh();
    } catch {
      setHistoryError('Could not load that scrape from this browser.');
    } finally {
      setHistoryBusy(false);
    }
  };

  const removeSnapshot = async (h: SnapshotMeta) => {
    try {
      await deleteSnapshot(h.id);
      if (savedId === h.id) {
        setSavedId(null); // the copy on screen is no longer saved anywhere
        setViewing(null);
      }
      await refreshHistory();
    } catch {
      setHistoryError('Could not delete that scrape.');
    }
  };

  const plugins = [...store.current.values()];
  const counts = new Map<string, number>();
  for (const p of plugins) for (const c of p.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
  const q = query.trim().toLowerCase();
  const mcpCounts = new Map<McpStatus, number>();
  for (const p of plugins) mcpCounts.set(p.mcpStatus, (mcpCounts.get(p.mcpStatus) ?? 0) + 1);
  const dev = fDev.trim().toLowerCase();
  const addedOf = (p: PsPlugin) => (p.createdAt ? String(p.createdAt).slice(0, 10) : '');
  const matching = plugins.filter((p) => {
    if (fCats.length && !p.categories.some((c) => fCats.includes(c))) return false;
    if (fMcp.length && !fMcp.includes(p.mcpStatus)) return false;
    if (dev && !p.developer.toLowerCase().includes(dev)) return false;
    if (fNoUrl && p.mcp.some((m) => isHttp(m.url))) return false;
    const added = addedOf(p);
    if ((fFrom && (!added || added < fFrom)) || (fTo && (!added || added > fTo))) return false;
    return !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.developer.toLowerCase().includes(q);
  });
  const shown = (() => {
    if (!addedSort) return matching;
    const at = (p: PsPlugin) => (p.createdAt ? Date.parse(p.createdAt) : NaN);
    return [...matching].sort((x, y) => {
      const a = at(x);
      const b = at(y);
      if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) === Number.isNaN(b) ? 0 : Number.isNaN(a) ? 1 : -1;
      return addedSort === 'asc' ? a - b : b - a;
    });
  })();
  // Newest first, then oldest first, then back to the directory's order.
  const cycleAddedSort = () => {
    setAddedSort((v) => nextSort(v, 'date'));
    setPage(1);
  };
  const activeFilters = [fCats.length > 0, fMcp.length > 0, !!dev, !!(fFrom || fTo), fNoUrl].filter(Boolean).length;
  const clearFilters = () => {
    setFCats([]);
    setFMcp([]);
    setFDev('');
    setFFrom('');
    setFTo('');
    setFNoUrl(false);
    setPage(1);
  };
  const catOptions: FilterOption[] = [...cats]
    .sort((x, y) => x.title.localeCompare(y.title))
    .map((c) => ({
      value: c.slug,
      label: c.status === 'listed' ? `${c.title} *` : c.title,
      hint: c.status === 'listed' ? 'The full list was not read for this category: only the home list (about 9 plugins)' : undefined,
    }));
  const mcpOptions: FilterOption[] = MCP_STATUS_ORDER.filter((x) => mcpCounts.get(x)).map((x) => ({ value: x, label: MCP_STATUS_LABEL[x] }));
  const endpointCount = shown.reduce((n, p) => n + p.mcp.length, 0);
  const totalPages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = shown.slice(start, start + PAGE_SIZE);
  const withDetail = plugins.filter((p) => p.hasDetail).length;
  const missing = plugins.length - withDetail;
  const today = new Date().toISOString().slice(0, 10);
  const fileBase = `chatgpt-plugins${fCats.length === 1 ? '-' + fCats[0] : ''}${fMcp.length === 1 ? '-' + fMcp[0] : ''}-${today}`;

  if (!active) return null;

  const detailsRunning = steps[1].state === 'running';
  const detailPct = plugins.length ? Math.round((withDetail / plugins.length) * 100) : 0;
  const catPct = catProgress ? Math.round((catProgress.done / catProgress.total) * 100) : 0;
  const minutesLeft = Math.ceil(missing / PER_SECOND / 60);
  const probeLines = probeLinesOf(shown);
  const titleOf = new Map(cats.map((c) => [c.slug, c.title]));

  // The report always covers the whole scrape, not the filtered view. A scrape opened from history is dated by when it was saved.
  const generateReport = async () => {
    if (generating || !plugins.length) return;
    setGenerating(true);
    try {
      await openReport(() => {
        const { html, asof } = generateChatGPTReportHtml(plugins, cats, viewing ? new Date(viewing.savedAt) : new Date());
        return { html, fileName: chatgptReportFileName(asof) };
      });
    } finally {
      setGenerating(false);
    }
  };
  const homeOnly = cats.filter((c) => c.status === 'listed');
  const filtered = shown.length !== plugins.length;

  const logPanel = log.length > 0 && (
    <details className="mt-4 text-sm text-gray-600">
      <summary className="cursor-pointer select-none font-medium text-gray-700">Log</summary>
      <div className="mt-2 h-44 max-w-5xl overflow-auto rounded-lg bg-[#282728] p-3 font-mono text-xs leading-relaxed">
        {log.map((l, i) => (
          <div key={i} className={LOG_COLOR[l.kind]}>
            <span className="text-gray-500">{l.at}</span> {l.text}
          </div>
        ))}
        <div ref={logEnd} />
      </div>
    </details>
  );

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Title and fetch status */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold text-[#282728]">ChatGPT Plugin Scraper</h1>
          <p className="mt-1 text-sm text-gray-500">Fetches the plugin directory live, then reads every plugin’s details automatically.</p>
        </div>
        {busy && (
          <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm text-gray-700 shadow-sm">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-[#86BC25]" />
            {detailsRunning ? `Fetching details… ${withDetail.toLocaleString()} / ${plugins.length.toLocaleString()}` : reading}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={fetchLive}
          disabled={busy}
          className={look.primary}
          title="Calls the chatgpt.com directory one request after another through this app’s backend: the home list, each category, then each plugin. chatgpt.com may refuse these server-side requests (a Cloudflare challenge or a sign-in); the run stops at the first refusal. Then use the capture script and Upload HAR file"
        >
          <Icon d={ICONS.live} />
          Fetch live
        </button>
        <span className="mx-1 hidden h-6 w-px bg-gray-300 sm:inline-block" aria-hidden="true" />
        {/* Fallback if Fetch live is refused: two steps, in order. */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white/60 px-2 py-1.5">
          <span className="px-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">Fallback</span>
          <button
            onClick={() => void copyScript()}
            disabled={busy}
            className={look.secondary}
            title="Step 1. Copies the capture script. Paste it in the Console (F12) of a signed-in chatgpt.com/plugins tab; it downloads a .har file to upload in step 2."
          >
            <StepBadge n={1} />
            <Icon d={ICONS.copy} />
            Copy capture script
          </button>
          <label className={`${look.secondary} cursor-pointer ${busy ? 'pointer-events-none opacity-40' : ''}`} title="Step 2. Upload the .har file written by the capture script">
            <StepBadge n={2} />
            <Icon d={ICONS.upload} />
            Upload HAR file
            <input
              type="file"
              accept=".har,application/json,.json"
              multiple
              disabled={busy}
              className="hidden"
              onChange={(e) => {
                uploadHar(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {busy && (
          <button onClick={stop} className={look.secondary}>
            <Icon d={ICONS.stop} />
            Stop
          </button>
        )}
        <span className="mx-1 hidden h-6 w-px bg-gray-300 sm:inline-block" aria-hidden="true" />
        {plugins.length > 0 &&
          !busy &&
          (savedId ? (
            <span className={`${base} border border-gray-300 bg-white text-[#282728]`} title="Saved in this browser's ChatGPT history">
              <Icon d={ICONS.check} className="h-4 w-4 text-[#6a9a1c]" />
              Saved
            </span>
          ) : (
            <button onClick={() => void saveScrape()} disabled={saving} className={look.primary} title="Keep this scrape in this browser's ChatGPT history">
              <Icon d={ICONS.save} />
              {saving ? 'Saving…' : 'Save scrape'}
            </button>
          ))}
        <button
          onClick={() => {
            setHistoryError(null);
            setHistoryOpen(true);
            void refreshHistory();
          }}
          className={look.secondary}
        >
          <Icon d={ICONS.clock} />
          History
          <Count>{history.length}</Count>
        </button>
        {cats.length > 0 && (
          <>
            <button
              onClick={() => void generateReport()}
              disabled={generating || busy || !plugins.length}
              className={look.secondary}
              title={busy ? 'Wait for the fetch to finish so the report covers every plugin' : 'Build the plugin dashboard report for the whole scrape (ignores the filters) and open it in a new tab'}
            >
              {generating ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-[#86BC25]" />
              ) : (
                <Icon d={ICONS.report} />
              )}
              {generating ? 'Generating…' : 'Generate report'}
            </button>
            <button
              onClick={() => onSendToProbe(probeLines)}
              disabled={busy || probeLines.length === 0}
              className={look.secondary}
              title={busy ? 'Wait for the scrape to finish before sending endpoints to the Probe' : filtered ? 'Send the MCP endpoint of every plugin shown (current filters and search) to the Probe' : 'Send every plugin’s MCP endpoint to the Probe'}
            >
              <Icon d={ICONS.send} />
              Send to Probe
              <Count>{probeLines.length.toLocaleString()}</Count>
            </button>
          </>
        )}
      </div>

      {scriptCopied && !busy && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-[#dcebc0] bg-[#f0f7e6] px-4 py-3 text-sm text-[#4f6e14]">
          <Icon d={ICONS.check} className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <span className="font-semibold">{scriptCopied === 'copied' ? 'Script copied.' : 'Copy the script from the box that opened.'}</span> Paste it in the Console (F12) of a signed-in{' '}
            <strong>chatgpt.com/plugins</strong> tab and press Enter. It downloads a <strong>.har</strong> file. Then come back to this page and click <strong>Step 2: Upload HAR file</strong> to load that file.
          </div>
          <button onClick={() => setScriptCopied(null)} className="ml-auto shrink-0 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Progress */}
      {busy && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex justify-between text-sm text-gray-700">
            <span>
              {detailsRunning
                ? `Fetching plugin details — ${withDetail.toLocaleString()} / ${plugins.length.toLocaleString()}${steps[1].info.includes('failed') ? ` · ${steps[1].info.split('·').pop()?.trim()}` : ''}`
                : catProgress
                  ? `${reading} — ${catProgress.done} / ${catProgress.total} categories done`
                  : reading}
            </span>
            {(detailsRunning || catProgress) && <span className="font-semibold">{detailsRunning ? detailPct : catPct}%</span>}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
            {detailsRunning || catProgress ? (
              <div className="h-full bg-[#86BC25] transition-all" style={{ width: `${detailsRunning ? detailPct : catPct}%` }} />
            ) : (
              <div className="h-full w-1/3 animate-pulse bg-[#86BC25]" />
            )}
          </div>
          {detailsRunning && minutesLeft > 0 && <div className="mt-1 text-xs text-gray-500">About {minutesLeft} min left</div>}
        </div>
      )}

      {viewing && !busy && (
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#f0f7e6] px-4 py-3 text-sm text-[#5a7a1a]">
          <span>
            Viewing the scrape saved {fmtDateTime(viewing.savedAt)} ({viewing.count.toLocaleString()} plugins). Exports and Send to Probe use this saved data.
          </span>
          <button onClick={() => setViewing(null)} className="ml-auto underline">
            Dismiss
          </button>
        </div>
      )}

      {!viewing && !busy && plugins.length > 0 && (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            homeOnly.length || missing > 0 ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-[#a7f3d0] bg-[#ecfdf5] text-[#059669]'
          }`}
        >
          {steps[1].state === 'skipped' ? 'Stopped' : 'Done'} — {plugins.length.toLocaleString()} plugins in {cats.length} categories, {withDetail.toLocaleString()} with details.
          {homeOnly.length > 0 && <span className="font-semibold"> No full list for {homeOnly.map((c) => c.title).join(', ')}; try again, or use the capture script.</span>}{' '}
          {savedId ? 'Saved to history.' : <span className="font-semibold text-amber-700">Not saved — click Save scrape to keep it in this browser.</span>}
        </div>
      )}

      {historyOpen && (
        <HistoryModal
          history={history}
          error={historyError}
          busy={historyBusy}
          onClose={() => setHistoryOpen(false)}
          onView={(h) => void viewSnapshot(h)}
          onDelete={(h) => void removeSnapshot(h)}
        />
      )}

      {error && (
        <div className="mt-4 max-w-4xl break-words rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex items-center rounded-md bg-red-200 px-2 py-0.5 font-mono text-xs font-bold text-red-900">
              {error.match(/\[(.*?)\]/)?.[1] || 'API Error'}
            </span>
            <div className="flex-1 space-y-1">
              <p className="font-semibold text-red-900">{error}</p>
              <p className="text-xs text-red-600">
                See the Activity Log below or browser developer console (Network tab) for the full request trace.
              </p>
            </div>
            <button
              onClick={() => void navigator.clipboard.writeText(error)}
              className="ml-auto shrink-0 inline-flex items-center rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
              title="Copy error to clipboard"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {!cats.length ? (
        <>
          {logPanel}
          {!busy && <div className="mt-8 rounded-lg border-2 border-dashed border-gray-300 py-20 text-center text-gray-500">Click <strong>Fetch live</strong> to begin. If chatgpt.com refuses it, use the fallback: <strong>Step 1: Copy capture script</strong>, then <strong>Step 2: Upload HAR file</strong>.</div>}
        </>
      ) : (
        <>
          {/* Search, the export buttons and the column filters share one card. The filters combine with the search, and the exports follow them. */}
          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                  <Icon d={ICONS.search} />
                </span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  aria-label="Search results"
                  placeholder="Search name, developer or description…"
                  className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#86BC25] sm:w-[26rem]"
                />
              </div>
              <span className="whitespace-nowrap text-sm text-gray-500">
                {shown.length ? `${(start + 1).toLocaleString()}–${(start + pageRows.length).toLocaleString()} of ${shown.length.toLocaleString()}` : '0 results'}
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  onClick={() => download(`${fileBase}.csv`, buildPsCsv(shown), 'text/csv;charset=utf-8')}
                  disabled={busy || !shown.length}
                  className={look.primary}
                  title={busy ? 'Wait for the scrape to finish so the export covers every plugin' : 'Download the plugins shown (current filters and search) as CSV, with the MCP columns'}
                >
                  <Icon d={ICONS.download} />
                  Export CSV
                  <Count tone="onPrimary">{shown.length.toLocaleString()}</Count>
                </button>
                <button
                  onClick={() => download(`${fileBase.replace('chatgpt-plugins', 'chatgpt-mcp-endpoints')}.csv`, buildMcpEndpointsCsv(shown), 'text/csv;charset=utf-8')}
                  disabled={busy || !endpointCount}
                  className={look.secondary}
                  title={busy ? 'Wait for the scrape to finish so the export covers every plugin' : 'One row per MCP server entry (URL, transport, auth) of the plugins shown, including local commands. Send to Probe counts only distinct remote URLs.'}
                >
                  <Icon d={ICONS.download} />
                  MCP endpoints CSV
                  <Count>{endpointCount.toLocaleString()}</Count>
                </button>
                <button
                  onClick={() => download(`chatgpt-plugins-all-${today}.json`, JSON.stringify(plugins, null, 2), 'application/json')}
                  disabled={busy || !plugins.length}
                  className={look.secondary}
                  title={busy ? 'Wait for the scrape to finish so the export covers every plugin' : undefined}
                >
                  <Icon d={ICONS.download} />
                  JSON
                </button>
              </div>
            </div>

            {/* One filter for each of Category, Developer, MCP endpoint and Added, plus the plugins that have no MCP endpoint. */}
            <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-3 border-t border-gray-100 pt-4">
              <div className="block text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
                Category
                <MultiSelectFilter options={catOptions} value={fCats} onChange={(next) => { setFCats(next); setPage(1); }} noun="category" nounPlural="categories" />
              </div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
                Developer
                <input
                  value={fDev}
                  onChange={(e) => {
                    setFDev(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Contains…"
                  className="mt-1 block h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm font-normal normal-case tracking-normal text-[#282728] focus:outline-none focus:ring-2 focus:ring-[#86BC25] w-44"
                />
              </label>
              <div className="block text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
                MCP endpoint
                <MultiSelectFilter options={mcpOptions} value={fMcp} onChange={(next) => { setFMcp(next); setPage(1); }} noun="kind" nounPlural="kinds" width="w-60" />
              </div>
              <div className="block text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
                Added
                <div className="mt-1 flex items-center gap-2 font-normal normal-case tracking-normal">
                  <input
                    type="date"
                    value={fFrom}
                    max={fTo || undefined}
                    onChange={(e) => {
                      setFFrom(e.target.value);
                      setPage(1);
                    }}
                    aria-label="Added from"
                    className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm text-[#282728] focus:outline-none focus:ring-2 focus:ring-[#86BC25] disabled:opacity-40"
                  />
                  <span className="text-sm text-gray-500">to</span>
                  <input
                    type="date"
                    value={fTo}
                    min={fFrom || undefined}
                    onChange={(e) => {
                      setFTo(e.target.value);
                      setPage(1);
                    }}
                    aria-label="Added to"
                    className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm text-[#282728] focus:outline-none focus:ring-2 focus:ring-[#86BC25] disabled:opacity-40"
                  />
                </div>
              </div>
              <div className="flex h-9 items-center text-sm text-gray-700">
                <label className="inline-flex items-center gap-1.5 whitespace-nowrap" title="Only the plugins with no remote MCP URL, which can't be sent to the Probe">
                  <input
                    type="checkbox"
                    checked={fNoUrl}
                    onChange={(e) => {
                      setFNoUrl(e.target.checked);
                      setPage(1);
                    }}
                    className="accent-[#86BC25]"
                  />
                  Without MCP endpoint
                </label>
              </div>
              {activeFilters > 0 && (
                <button onClick={clearFilters} className="ml-auto h-9 whitespace-nowrap text-sm font-semibold text-[#5a7a1a] underline">
                  Clear filters ({activeFilters})
                </button>
              )}
            </div>
          </div>

          {logPanel}

          {/* Table */}
          <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#282728] text-left text-[11px] uppercase tracking-wide text-[#86BC25]">
                  {['Plugin', 'Developer', 'Description', 'Categories', 'MCP endpoint'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2">
                      {h}
                    </th>
                  ))}
                  <SortHeader label="Added" kind="date" dir={addedSort} onSort={cycleAddedSort} />
                  <th className="whitespace-nowrap px-3 py-2">Website</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                      No plugins match {query.trim() ? <>“{query.trim()}”</> : 'the filters'}
                      {query.trim() && activeFilters > 0 ? ' and the filters' : ''}.
                    </td>
                  </tr>
                )}
                {pageRows.map((p) => (
                  <tr key={p.id || p.name} className="border-t border-gray-100 align-top hover:bg-[#f0f7e6]">
                    <td className="px-3 py-2.5" title={p.id}>
                      <div className="font-semibold text-[#282728]">{p.name}</div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-700">{p.developer || (p.hasDetail ? <span className="text-gray-300">—</span> : '…')}</td>
                    <td className="min-w-[16rem] max-w-sm px-3 py-2.5 text-gray-600">
                      <div className="line-clamp-2" title={p.description}>
                        {p.description}
                      </div>
                    </td>
                    <td className="min-w-[10rem] px-3 py-2.5">
                      <div className="flex flex-wrap gap-1" title={p.categories.map((c) => titleOf.get(c) ?? c).join(', ')}>
                        {p.categories.slice(0, 2).map((c) => (
                          <span key={c} className="rounded bg-[#f0f7e6] px-2 py-0.5 text-[11px] font-semibold text-[#5a7a1a]">
                            {titleOf.get(c) ?? c}
                          </span>
                        ))}
                        {p.categories.length > 2 && <span className="px-1 py-0.5 text-[11px] text-gray-500">+{p.categories.length - 2}</span>}
                      </div>
                    </td>
                    <td className="min-w-[16rem] max-w-md px-3 py-2.5">
                      {p.mcp.length === 0 ? (
                        p.hasDetail ? (
                          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${MCP_BADGE[p.mcpStatus]}`}>{MCP_STATUS_LABEL[p.mcpStatus]}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )
                      ) : (
                        p.mcp.map((m, i) => (
                          <div key={i} className="mb-1 break-all last:mb-0">
                            {m.url ? (
                              <span className="font-mono text-xs text-[#282728]">{m.url}</span>
                            ) : m.command ? (
                              <span className="font-mono text-xs">local: {m.command}</span>
                            ) : (
                              <span className="font-mono text-xs text-red-700">{m.raw}</span>
                            )}
                            <span className="ml-2 text-[11px] text-gray-500">{[m.transport || (m.url ? '' : 'stdio'), m.auth].filter(Boolean).join(' · ')}</span>
                          </div>
                        ))
                      )}
                      {p.mcpMentioned && <div className="mt-1 break-all text-[11px] text-amber-700">mentioned in description: {p.mcpMentioned}</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5" title={p.createdAt}>{fmtDate(p.createdAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {p.website ? (
                        <a href={p.website} target="_blank" rel="noreferrer" className="text-[#4f6e14] hover:underline" title={p.website}>
                          {p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 32)}
                        </a>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm">
              <button disabled={currentPage === 1} onClick={() => setPage(1)} className={look.secondary}>« First</button>
              <button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className={look.secondary}>‹ Prev</button>
              <span className="px-3 text-gray-600">Page {currentPage.toLocaleString()} of {totalPages.toLocaleString()}</span>
              <button disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} className={look.secondary}>Next ›</button>
              <button disabled={currentPage === totalPages} onClick={() => setPage(totalPages)} className={look.secondary}>Last »</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const MCP_BADGE: Record<McpStatus, string> = {
  remote: 'bg-[#f0f7e6] text-[#4f6e14]',
  'local-only': 'bg-amber-50 text-amber-700',
  unrecognised: 'bg-red-50 text-red-700',
  'app-unpublished': 'bg-gray-100 text-gray-600',
  connector: 'bg-gray-100 text-gray-600',
  'skills-only': 'bg-gray-100 text-gray-600',
  none: 'bg-gray-100 text-gray-600',
  'not-fetched': 'bg-gray-50 text-gray-400',
};

/** A small numbered circle for the fallback steps. */
function StepBadge({ n }: { n: number }) {
  return <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#282728] text-[11px] font-bold text-[#86BC25]">{n}</span>;
}

