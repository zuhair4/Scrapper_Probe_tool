import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Item,
  PROXY_BASE,
  REAL_ENDPOINT,
  baseParams,
  buildCSV,
  classify,
  fetchPage,
  fmtDate,
  fmtDateTime,
  getEndpoints,
  getRawType,
  humanize,
  allTaxValues,
  primaryTaxonomy,
  probeLineFor,
  probeSendFor,
  shorten,
} from './claudeDirectory';
import { SnapshotMeta, deleteSnapshot, listSnapshots, loadSnapshotItems, saveSnapshot } from './claudeHistoryDb';
import { CatBadge, HistoryModal, ItemModal } from './ClaudeScraperModals';
import { CategoryFilter, NO_CATEGORY } from './CategoryFilter';
import { SortHeader, nextSort } from '../../shared/SortHeader';
import type { SortDir } from '../../shared/SortHeader';
import { generateReportHtml } from '../reports/generateClaudeReport';
import { reportFileName } from '../reports/fillReportTemplate';
import { openReport } from '../reports/openReport';
import { base, Count, Icon, ICONS, look, ToolbarGroup } from '../../shared/toolbar';

const PAGE_SIZE = 20;
const NONE = '__none__';
type Tab = 'connectors' | 'plugins' | 'extensions' | 'all';
const TABS: { key: Tab; label: string }[] = [
  { key: 'connectors', label: 'Connectors' },
  { key: 'plugins', label: 'Plugins' },
  { key: 'extensions', label: 'Extensions' },
  { key: 'all', label: 'All' },
];
const TAB_CAT: Record<Exclude<Tab, 'all'>, string> = {
  connectors: 'Connector',
  plugins: 'Plugin',
  extensions: 'Extension',
};

interface Progress {
  pages: number;
  items: number;
  expected?: number;
}


export interface Directory {
  items: Item[];
  asOf: string | null;
}

/** Shown on the buttons that use the results, which stay off until the fetch is done so they cover every row. */
const WAIT_FOR_FETCH = 'Wait for the scrape to finish so this covers every item';

export default function ScraperPage({
  onSendToProbe,
  onDirectoryChange,
  snapId,
  onSnapSaved,
}: {
  onSendToProbe: (lines: string[], categories?: Record<string, string>) => void;
  onDirectoryChange?: (d: Directory) => void;
  /** When set, auto-load this saved snapshot (from /claude/{snap-id} routing). */
  snapId?: string;
  /** Called after a successful save with the new snapshot's id, so the parent can update the URL. */
  onSnapSaved?: (id: string) => void;
}) {
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('connectors');
  const [rawVisible, setRawVisible] = useState(false);
  const [rawSample, setRawSample] = useState<unknown>(null);
  const [query, setQuery] = useState('');
  // Column filters. '' means all; NONE means the rows that have no value in that column.
  const [fTax, setFTax] = useState<string[]>([]); // ticked categories, any of them matches
  const [fPub, setFPub] = useState('');
  const [fTier, setFTier] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fNoDate, setFNoDate] = useState(false);
  const [fNoUrl, setFNoUrl] = useState(false);
  // Order of the Added column: '' keeps the directory's own order. Rows with no added date always come last.
  const [addedSort, setAddedSort] = useState<SortDir>('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Item | null>(null);
  const [history, setHistory] = useState<SnapshotMeta[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<SnapshotMeta | null>(null);
  const [saveMsg, setSaveMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [stopped, setStopped] = useState(false);
  // Scrapes are only kept when the user clicks Save scrape. `savedId` is the history entry that
  // holds the results on screen (also set when a saved scrape is opened from history).
  const [savedId, setSavedId] = useState<string | null>(null);
  const [fetchMeta, setFetchMeta] = useState<{ pages: number; expected: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  // When the on-screen data was fetched (or the saved scrape's fetch time): the report's as-of date.
  const [dataAsOf, setDataAsOf] = useState<string | null>(null);

  // Lets the probe report join its results to the current scrape.
  useEffect(() => {
    onDirectoryChange?.({ items: allItems, asOf: dataAsOf });
  }, [allItems, dataAsOf, onDirectoryChange]);
  const [generating, setGenerating] = useState(false);

  const stopRef = useRef(false);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await listSnapshots());
    } catch {
      setHistoryError('Could not read saved history from this browser.');
    } finally {
      setHistoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  // Auto-load the snapshot when the URL is /claude/{snap-id}. Runs once history is loaded and
  // whenever snapId changes (e.g. browser back/forward). Skips if that snap is already on screen.
  useEffect(() => {
    if (!snapId || !historyLoaded) return;
    if (viewing?.id === snapId || savedId === snapId) return;
    const meta = history.find((h) => h.id === snapId);
    if (meta) void viewSnapshot(meta);
    // if not found: viewSnapshot sets the error; historyLoaded being true means we looked
  }, [snapId, historyLoaded, history]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAll = useCallback(async () => {
    stopRef.current = false;
    setLoading(true);
    setError(null);
    setAllItems([]);
    setRawSample(null);
    setViewing(null);
    setSaveMsg('');
    setSavedId(null);
    setFetchMeta(null);
    setDataAsOf(null);
    setProgress({ pages: 0, items: 0 });
    setStopped(false);
    setPage(1);

    const collected: Item[] = [];
    const seen = new Set<string>();
    let expected = 0;
    let pages = 0;
    let cursor: string | undefined;

    try {
      for (;;) {
        if (stopRef.current) break;
        const params = baseParams();
        if (cursor) params.set('page', cursor);
        const data = await fetchPage(params, stopRef);
        if (!data) break;
        pages++;

        if (pages === 1) {
          setRawSample({ ...data, facets: undefined, data: data.data?.slice(0, 2) });
          expected = (data.facets?.source ?? []).reduce((n: number, s: Item) => n + (s?.count ?? 0), 0);
        }
        for (const it of data.data ?? []) {
          if (it?.id != null) {
            if (seen.has(it.id)) continue;
            seen.add(it.id);
          }
          collected.push(it);
        }
        setAllItems([...collected]);
        setProgress({ pages, items: collected.length, expected });

        if (!data.next_page) break;
        cursor = data.next_page;
      }

      // Nothing is saved automatically: the user decides with the Save scrape button.
      setFetchMeta({ pages, expected });
      setDataAsOf(new Date().toISOString());
      setStopped(stopRef.current);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const stop = () => {
    stopRef.current = true;
  };

  const viewSnapshot = async (h: SnapshotMeta) => {
    setHistoryBusy(true);
    try {
      const items = await loadSnapshotItems(h.id);
      setAllItems(items);
      setProgress(null);
      setError(null);
      setSaveMsg('');
      setViewing(h);
      setSavedId(h.id); // it came from history, so it is already saved
      setFetchMeta(null);
      setDataAsOf(h.fetchedAt ?? h.savedAt);
      setActiveTab('connectors');
      setQuery('');
      setPage(1);
      setHistoryOpen(false);
    } catch {
      setHistoryError('Could not load that snapshot from this browser.');
    } finally {
      setHistoryBusy(false);
    }
  };

  const removeSnapshot = async (h: SnapshotMeta) => {
    try {
      await deleteSnapshot(h.id);
      if (viewing?.id === h.id) setViewing(null);
      if (savedId === h.id) setSavedId(null); // the copy on screen is no longer saved anywhere
      await refreshHistory();
    } catch {
      setHistoryError('Could not delete that snapshot.');
    }
  };

  const copyEndpoint = async () => {
    const url = `${REAL_ENDPOINT}?${baseParams()}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy the full URL:', url);
    }
  };

  // ─── Derived ──────────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { all: allItems.length, connectors: 0, plugins: 0, extensions: 0 };
    for (const i of allItems) {
      const k = classify(i);
      if (k === 'Connector') c.connectors++;
      else if (k === 'Plugin') c.plugins++;
      else c.extensions++;
    }
    return c;
  }, [allItems]);

  const tabItems = useMemo(
    () => (activeTab === 'all' ? allItems : allItems.filter((i) => classify(i) === TAB_CAT[activeTab])),
    [allItems, activeTab]
  );

  // What the search looks in: name and publisher. Category, tier and added date have filters of their own.
  const searchText = useMemo(() => {
    const m = new Map<Item, string>();
    for (const i of allItems) m.set(i, `${i.name || i.title || ''}
${i.publisher?.name ?? ''}`.toLowerCase());
    return m;
  }, [allItems]);

  // The choices in the Category and Tier filters: what this tab has, in alphabetical order.
  const taxOptions = useMemo(() => {
    const c = new Set<string>();
    let none = false;
    for (const i of tabItems) {
      const vs = allTaxValues(i);
      if (!vs.length) none = true;
      for (const v of vs) c.add(v);
    }
    return { list: [...c].sort((x, y) => humanize(x).localeCompare(humanize(y))), none };
  }, [tabItems]);
  const tierOptions = useMemo(() => {
    const c = new Set<string>();
    let none = false;
    for (const i of tabItems) {
      if (i.verified_tier) c.add(i.verified_tier);
      else none = true;
    }
    return { list: [...c].sort(), none };
  }, [tabItems]);

  const activeFilters = [fTax.length > 0, fPub.trim(), fTier, fFrom || fTo || fNoDate, fNoUrl].filter(Boolean).length;
  const clearFilters = () => {
    setFTax([]);
    setFPub('');
    setFTier('');
    setFFrom('');
    setFTo('');
    setFNoDate(false);
    setFNoUrl(false);
    setPage(1);
  };

  const displayItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pub = fPub.trim().toLowerCase();
    const rows = tabItems.filter((i) => {
      if (q && !(searchText.get(i) ?? '').includes(q)) return false;
      if (fNoUrl && probeLineFor(i) !== null) return false;
      if (fTax.length) {
        const vs = allTaxValues(i);
        if (!(vs.length ? vs.some((v) => fTax.includes(v)) : fTax.includes(NO_CATEGORY))) return false;
      }
      if (pub && !String(i.publisher?.name ?? '').toLowerCase().includes(pub)) return false;
      if (fTier && (fTier === NONE ? !!i.verified_tier : i.verified_tier !== fTier)) return false;
      const added = i.added_time ? String(i.added_time).slice(0, 10) : '';
      if (fNoDate) return !added;
      if (fFrom && (!added || added < fFrom)) return false;
      if (fTo && (!added || added > fTo)) return false;
      return true;
    });
    if (!addedSort) return rows;
    const at = (i: Item) => (i.added_time ? Date.parse(i.added_time) : NaN);
    return rows.sort((a, b) => {
      const x = at(a);
      const y = at(b);
      if (Number.isNaN(x) || Number.isNaN(y)) return Number.isNaN(x) === Number.isNaN(y) ? 0 : Number.isNaN(x) ? 1 : -1;
      return addedSort === 'asc' ? x - y : y - x;
    });
  }, [tabItems, searchText, query, fTax, fPub, fTier, fFrom, fTo, fNoDate, fNoUrl, addedSort]);

  // Newest first, then oldest first, then back to the directory's order.
  const cycleAddedSort = () => {
    setAddedSort((v) => nextSort(v, 'date'));
    setPage(1);
  };

  // Only Connectors are probed. The count is rows, like Export CSV, minus rows with no fixed URL.
  const canProbe = activeTab === 'connectors';
  // The report covers connectors only, so it is off on the Plugins and Extensions tabs (Connectors and All still build it).
  const canReport = activeTab === 'connectors' || activeTab === 'all';
  const probeSend = useMemo(() => (canProbe ? probeSendFor(displayItems) : { lines: [], categories: {} }), [canProbe, displayItems]);
  const probeLines = probeSend.lines;

  // Every row of the Connectors, Plugins and Extensions tabs has the same type, so the column is only there on All.
  const showType = activeTab === 'all';
  const columns = [
    'Name',
    ...(showType ? ['Type'] : []),
    'Components',
    'MCP endpoint',
    'Category',
    'Publisher',
    'Tier',
    'Added',
    'Updated',
    'Description',
  ];

  const totalPages = Math.max(1, Math.ceil(displayItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = displayItems.slice(start, start + PAGE_SIZE);

  const downloadCSV = () => {
    if (loading) return;
    const blob = new Blob([buildCSV(displayItems)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claude_${activeTab}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasItems = allItems.length > 0;
  const exp = progress?.expected;

  const saved = savedId !== null;
  const unsaved = hasItems && !saved;

  const saveScrape = async () => {
    if (saving || loading || !hasItems || saved) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const rec = await saveSnapshot(
        {
          pages: fetchMeta?.pages,
          expected: fetchMeta?.expected,
          fetchedAt: dataAsOf ?? undefined,
          connectors: counts.connectors,
          plugins: counts.plugins,
          extensions: counts.extensions,
        },
        allItems
      );
      setSavedId(rec.id);
      onSnapSaved?.(rec.id);
      void refreshHistory();
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      setSaveMsg(`Could not save (${why}). Use Export CSV to keep the results.`);
    } finally {
      setSaving(false);
    }
  };

  const generateReport = async () => {
    if (generating || loading || !canReport || counts.connectors === 0) return;
    setGenerating(true);
    try {
      await openReport(() => {
        const { html, asof } = generateReportHtml(allItems, dataAsOf ? new Date(dataAsOf) : new Date());
        return { html, fileName: reportFileName(asof) };
      });
    } finally {
      setGenerating(false);
    }
  };

  // Leaving or reloading with results that aren't saved loses them, so ask first.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  // Replacing or clearing unsaved results needs a yes.
  const confirmDiscard = () =>
    !unsaved || window.confirm('These results are not saved and will be lost. Continue without saving?');

  const fetchPct = exp ? Math.min(100, Math.round(((progress?.items ?? 0) / exp) * 100)) : null;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Title and fetch status */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold text-[#282728]">Claude Directory Scraper</h1>
          <p className="mt-1 text-sm text-gray-500">Paginates the API until no pages remain, then export to CSV.</p>
        </div>
        {loading && (
          <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm text-gray-700 shadow-sm">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-[#86BC25]" />
            Fetching… {progress?.items ?? 0}
            {exp ? ` / ${exp}` : ''}
          </span>
        )}
        {!loading && progress && !error && !stopped && progress.pages > 0 && (
          <span
            className="inline-flex items-center gap-2 rounded-full border border-[#a7f3d0] bg-[#ecfdf5] px-4 py-1.5 text-sm font-semibold text-[#059669]"
            title="The fetch finished"
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#059669] text-white">
              <Icon d={ICONS.check} className="h-3 w-3" />
            </span>
            {progress.items} items fetched
          </span>
        )}
        {!loading && stopped && (
          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-sm font-semibold text-amber-700">
            Stopped at {progress?.items ?? 0} items
          </span>
        )}
        {/* Fetch, save and history controls: one row, under the title and status */}
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {loading ? (
            <button onClick={stop} className={look.secondary}>
              <Icon d={ICONS.stop} />
              Stop
            </button>
          ) : (
            <button
              onClick={() => {
                if (confirmDiscard()) void fetchAll();
              }}
              className={look.primary}
              title={fetchMeta ? 'Fetch the whole directory again' : undefined}
            >
              <Icon d={ICONS.refresh} />
              {fetchMeta ? 'Rerun' : 'Fetch All Pages'}
            </button>
          )}
          <span className="mx-1 hidden h-6 w-px bg-gray-300 sm:inline-block" aria-hidden="true" />
          {hasItems &&
            !loading &&
            (saved ? (
              <span
                className={`${base} border border-gray-300 bg-white text-[#282728]`}
                title="Saved in Scraper history"
              >
                <Icon d={ICONS.check} className="h-4 w-4 text-[#6a9a1c]" />
                Saved
              </span>
            ) : (
              <button
                onClick={() => void saveScrape()}
                disabled={saving}
                title="Keep this scrape in Scraper history"
                className={look.primary}
              >
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
        </div>
      </div>

      {/* Actions, grouped by what they do */}
      <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm empty:hidden">
        {displayItems.length > 0 && (
          <>
          <ToolbarGroup label="Use the results">
            {/* Same as Send to Probe below: the disabled button ignores the pointer so the wrapper gets the hover and shows the reason. */}
            <span className="group/tip relative inline-flex">
              <button
                onClick={generateReport}
                disabled={generating || loading || !canReport || counts.connectors === 0}
                title={
                  !canReport
                    ? undefined
                    : loading
                    ? WAIT_FOR_FETCH
                    : counts.connectors === 0
                    ? 'The report covers connectors only, and this scrape has none'
                    : activeTab === 'all'
                    ? 'The report is based on connectors only. It does not include plugins or extensions.'
                    : 'Build the connector dashboard report (connectors only) and open it in a new tab'
                }
                className={`${look.secondary} ${canReport ? '' : 'pointer-events-none'}`}
              >
                {generating ? (
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-[#86BC25]" />
                ) : (
                  <Icon d={ICONS.report} />
                )}
                {generating ? 'Generating…' : 'Generate report'}
              </button>
              {!canReport && (
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 rounded-lg bg-[#282728] px-3 py-2 text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover/tip:opacity-100"
                >
                  The report covers <strong className="font-semibold text-[#86BC25]">Connectors</strong> only. Switch to the Connectors or All tab to generate it.
                </span>
              )}
            </span>
            {/* A native title does not show on a disabled button, so the reason is a tooltip of our own. The disabled button ignores the
                pointer so the wrapper gets the hover. */}
            <span className="group/tip relative inline-flex">
              <button
                onClick={() => onSendToProbe(probeLines, probeSend.categories)}
                disabled={loading || !canProbe || probeLines.length === 0}
                title={loading ? WAIT_FOR_FETCH : canProbe ? 'Send the MCP endpoint of every connector shown (current search) to the Probe' : undefined}
                className={`${look.secondary} ${canProbe ? '' : 'pointer-events-none'}`}
              >
                <Icon d={ICONS.send} />
                Send to Probe
                {canProbe && <Count>{probeLines.length}</Count>}
              </button>
              {!canProbe && (
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 rounded-lg bg-[#282728] px-3 py-2 text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover/tip:opacity-100"
                >
                  Only <strong className="font-semibold text-[#86BC25]">Connectors</strong> can be sent to the Probe. Switch to the Connectors tab to send them.
                </span>
              )}
            </span>
            <button onClick={downloadCSV} disabled={loading} className={look.primary} title={loading ? WAIT_FOR_FETCH : 'Download the rows shown as CSV'}>
              <Icon d={ICONS.download} />
              Export CSV
              <Count tone="onPrimary">{displayItems.length}</Count>
            </button>
          </ToolbarGroup>
          {activeTab === 'all' && (
            <p className="basis-full text-xs text-gray-500">
              Generate report is based on connectors only. It does not include plugins or extensions.
            </p>
          )}
          </>
        )}
      </div>

      {/* Request details, tucked away until wanted */}
      <details className="group mt-4 rounded-xl border border-gray-200 bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none select-none items-center gap-2 px-4 py-3 text-sm font-semibold text-gray-700">
          <Icon d={ICONS.chevron} className="h-4 w-4 transition-transform group-open:rotate-180" />
          Endpoint and request details
        </summary>
        <div className="border-t border-gray-100 px-4 pb-4 pt-3">
          <div className="mb-1 text-xs font-semibold text-gray-600">Endpoint (GET):</div>
          <div className="flex flex-wrap items-center gap-3">
            <code
              className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs"
              title={`${REAL_ENDPOINT}?${baseParams()}`}
            >
              {REAL_ENDPOINT}?
            </code>
            <button onClick={() => void copyEndpoint()} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
              {copied ? 'Copied' : 'Copy full URL'}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Next pages append <code>&amp;page=&lt;next_page cursor&gt;</code> until the response has no <code>next_page</code>.
            The browser calls <code>{PROXY_BASE}?…</code>, which the Vite dev proxy forwards to the URL above.
          </p>
        </div>
      </details>

      {loading && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex justify-between text-sm text-gray-700">
            <span>
              Page {progress?.pages ?? 0} — {progress?.items ?? 0}
              {exp ? ` / ${exp}` : ''} items fetched…
            </span>
            {fetchPct !== null && <span className="font-semibold">{fetchPct}%</span>}
          </div>
          {fetchPct !== null && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
              <div className="h-full bg-[#86BC25] transition-all" style={{ width: `${fetchPct}%` }} />
            </div>
          )}
        </div>
      )}

      {viewing && !loading && (
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#f0f7e6] px-4 py-3 text-sm text-[#5a7a1a]">
          <span>
            Viewing saved fetch from {fmtDateTime(viewing.savedAt)} ({viewing.count} items). Exports use this saved data.
          </span>
          <button onClick={() => setViewing(null)} className="ml-auto underline">Dismiss</button>
        </div>
      )}

      {!loading && progress && (
        <div className="mt-4 rounded-xl border border-[#a7f3d0] bg-[#ecfdf5] px-4 py-3 text-sm text-[#059669]">
          {stopped ? 'Stopped' : 'Done'} — {progress.items} items across {progress.pages} pages
          {exp ? (progress.items >= exp - 5 ? ` (server reports ${exp} total — complete)` : ' — short, run again') : ''}.{' '}
          {saved ? (
            'Saved to history.'
          ) : (
            <span className="font-semibold text-amber-700">Not saved — click Save scrape to keep it in Scraper history.</span>
          )}
          {saveMsg && <span className="font-semibold text-red-700"> {saveMsg}</span>}
        </div>
      )}

      {snapId && historyLoaded && !history.find((h) => h.id === snapId) && !viewing && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Scrape not found.</strong> The saved scrape <code className="text-xs">{snapId}</code> isn't in this browser's history.
          Scrapes are saved in this browser only, and the newest {15} are kept.{' '}
          <button onClick={() => { setHistoryError(null); setHistoryOpen(true); }} className="underline font-semibold">Open history</button>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div>Error: {error}</div>
          <div className="mt-1 text-xs">
            Make sure the Vite dev server is running (<code>npm run dev</code>) for the proxy to work.
          </div>
        </div>
      )}

      {hasItems && (
        <>
          {/* Tabs, search and column filters share one card. The filters combine with the search and the tabs, and the exports follow them. */}
          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-xl bg-gray-100 p-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => {
                    setActiveTab(t.key);
                    setFTax([]); // the category choices differ between tabs
                    setPage(1);
                  }}
                  className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
                    activeTab === t.key ? 'bg-white text-[#282728] shadow-sm' : 'text-gray-500 hover:text-[#282728]'
                  }`}
                >
                  {t.label}{' '}
                  <span className={`text-xs font-bold ${activeTab === t.key ? 'text-[#6a9a1c]' : 'text-gray-400'}`}>
                    {counts[t.key]}
                  </span>
                </button>
              ))}
            </div>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <Icon d={ICONS.search} />
              </span>
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                aria-label="Search results"
                placeholder="Search name or publisher…"
                className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#86BC25] sm:w-[26rem]"
              />
            </div>
            <span className="text-sm text-gray-500">
              {displayItems.length ? `${start + 1}–${start + pageItems.length} of ${displayItems.length}` : '0 results'}
            </span>
            {rawSample != null && (
              <button onClick={() => setRawVisible((v) => !v)} className="ml-auto text-xs underline text-gray-600">
                {rawVisible ? 'Hide' : 'Inspect raw API sample'}
              </button>
            )}
          </div>

          {/* One filter for each of the Category, Publisher, Tier and Added columns, plus the connectors that have no MCP endpoint. */}
          <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-3 border-t border-gray-100 pt-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
              Category
              <CategoryFilter
                options={taxOptions}
                value={fTax}
                onChange={(next) => {
                  setFTax(next);
                  setPage(1);
                }}
              />
            </div>
            <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
              Publisher
              <input
                value={fPub}
                onChange={(e) => {
                  setFPub(e.target.value);
                  setPage(1);
                }}
                placeholder="Contains…"
                className="mt-1 block h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm font-normal normal-case tracking-normal text-[#282728] focus:outline-none focus:ring-2 focus:ring-[#86BC25] w-44"
              />
            </label>
            <label className="block text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
              Tier
              <select
                value={fTier}
                onChange={(e) => {
                  setFTier(e.target.value);
                  setPage(1);
                }}
                className="mt-1 block h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm font-normal normal-case tracking-normal text-[#282728] focus:outline-none focus:ring-2 focus:ring-[#86BC25] w-40"
              >
                <option value="">All</option>
                {tierOptions.list.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
                {tierOptions.none && <option value={NONE}>No tier</option>}
              </select>
            </label>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
              Added
              <div className="mt-1 flex items-center gap-2 font-normal normal-case tracking-normal">
                <input
                  type="date"
                  value={fFrom}
                  max={fTo || undefined}
                  disabled={fNoDate}
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
                  disabled={fNoDate}
                  onChange={(e) => {
                    setFTo(e.target.value);
                    setPage(1);
                  }}
                  aria-label="Added to"
                  className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm text-[#282728] focus:outline-none focus:ring-2 focus:ring-[#86BC25] disabled:opacity-40"
                />
              </div>
            </div>
            <div className="flex h-9 items-center gap-4 text-sm text-gray-700">
              <label className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={fNoDate}
                  onChange={(e) => {
                    setFNoDate(e.target.checked);
                    setPage(1);
                  }}
                  className="accent-[#86BC25]"
                />
                No added date
              </label>
              <label
                className="inline-flex items-center gap-1.5 whitespace-nowrap"
                title="Only the rows with no fixed MCP URL (the user supplies the host), which can't be probed"
              >
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

          {rawVisible && rawSample != null && (
            <pre className="mt-3 bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-x-auto max-h-96">
              {(() => {
                const s = JSON.stringify(rawSample, null, 2);
                return s.length > 4000 ? `${s.slice(0, 4000)}\n…(truncated)` : s;
              })()}
            </pre>
          )}

          <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#282728] text-[#86BC25] text-left text-[11px] uppercase tracking-wide">
                  {columns.map((h) =>
                    h === 'Added' ? (
                      <SortHeader key={h} label="Added" kind="date" dir={addedSort} onSort={cycleAddedSort} />
                    ) : (
                      <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {pageItems.length === 0 && (
                  <tr>
                    <td colSpan={columns.length} className="px-3 py-8 text-center text-gray-500">
                      No results match {query.trim() ? <>“{query.trim()}”</> : 'the filters'}
                      {query.trim() && activeFilters > 0 ? ' and the filters' : ''}.
                    </td>
                  </tr>
                )}
                {pageItems.map((item, idx) => {
                  const eps = getEndpoints(item);
                  const primary = primaryTaxonomy(item);
                  const others = allTaxValues(item).filter((v) => v !== primary);
                  return (
                    <tr key={item.id || idx} className="border-t border-gray-100 hover:bg-[#f0f7e6] align-top">
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setSelected(item)}
                          className="text-left font-semibold text-[#282728] underline decoration-dashed underline-offset-2 hover:text-[#5a7a1a]"
                        >
                          {item.name || item.title || 'Untitled'}
                        </button>
                      </td>
                      {showType && <td className="px-3 py-2"><CatBadge cat={classify(item)} /></td>}
                      <td className="px-3 py-2 font-mono text-xs">{getRawType(item)}</td>
                      <td className="px-3 py-2 font-mono text-xs" title={eps.join('\n')}>
                        {eps.length ? (
                          <>
                            {shorten(eps[0])}
                            {eps.length > 1 && <span className="text-gray-500"> +{eps.length - 1} more</span>}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 min-w-[150px] max-w-[220px]">
                        {primary ? (
                          <>
                            <span className="text-xs px-2 py-0.5 rounded bg-[#f0f7e6] text-[#5a7a1a] font-semibold">{humanize(primary)}</span>
                            {others.length > 0 && (
                              <div className="text-xs text-gray-500 mt-1">{others.map(humanize).join(', ')}</div>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2">{item.publisher?.name ?? '—'}</td>
                      <td className="px-3 py-2">{item.verified_tier ?? '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap" title={item.added_time ?? ''}>{fmtDate(item.added_time)}</td>
                      <td className="px-3 py-2 whitespace-nowrap" title={item.updated_time ?? ''}>{fmtDate(item.updated_time)}</td>
                      <td className="px-3 py-2 max-w-[360px] text-gray-600">
                        {String(item.summary || item.description || '').slice(0, 120)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm">
              <button disabled={currentPage === 1} onClick={() => setPage(1)} className={look.secondary}>« First</button>
              <button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className={look.secondary}>‹ Prev</button>
              <span className="px-3 text-gray-600">Page {currentPage} of {totalPages}</span>
              <button disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} className={look.secondary}>Next ›</button>
              <button disabled={currentPage === totalPages} onClick={() => setPage(totalPages)} className={look.secondary}>Last »</button>
            </div>
          )}
        </>
      )}

      {!loading && !hasItems && !error && (
        <div className="mt-8 border-2 border-dashed border-gray-300 rounded-lg py-20 text-center text-gray-500">
          Click <strong>Fetch All Pages</strong> to begin. It will keep paginating until the API returns no more results.
        </div>
      )}

      {selected && <ItemModal item={selected} onClose={() => setSelected(null)} onSendToProbe={onSendToProbe} />}
      {historyOpen && (
        <HistoryModal
          history={history}
          error={historyError}
          busyId={historyBusy}
          onClose={() => setHistoryOpen(false)}
          onView={(h) => void viewSnapshot(h)}
          onDelete={(h) => void removeSnapshot(h)}
        />
      )}
    </div>
  );
}
