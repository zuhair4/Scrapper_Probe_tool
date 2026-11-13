import { useCallback, useMemo, useState } from 'react';
import ResultsTable from './ProbeResultsTable';
import DetailDrawer from './ProbeDetailDrawer';
import ExportButtons from './ProbeExportButtons';
import { summarize } from '../lib/summary';
import { displayName } from '../lib/appName';
import { openReport } from '../../reports/openReport';
import { generateProbeReportHtml, probeReportFileName } from '../../reports/generateProbeReport';
import { listSnapshots, loadSnapshotItems } from '../../claude-scraper/claudeHistoryDb';
import type { Item } from '../../claude-scraper/claudeDirectory';
import type { RunSummary } from '../lib/summary';
import type { RunState } from '../lib/probeTypes';
import { base, Count, Icon, ICONS, look, ToolbarGroup } from '../../../shared/toolbar';

interface Props {
  saved: boolean;
  onSave: () => void;
  historyCount: number;
  onNewProbe: () => void;
  onOpenHistory: () => void;
  run: RunState;
  busy: boolean;
  onCancel: () => void;
  onRerun: () => void;
  /** The scraper's current results, used to add tier, launch month and category to the report. */
  getDirectory: () => { items: Item[] };
}

export default function RunView({ run, busy, onCancel, onRerun, historyCount, onNewProbe, onOpenHistory, saved, onSave, getDirectory }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const total = run.endpoints.length;
  const done = run.endpoints.filter((e) => e.completedAt).length;
  const probing = run.endpoints.filter((e) => e.startedAt > 0 && !e.completedAt);
  const isRunning = run.status === 'running';

  // Only in-flight endpoints can have fresh activity; scanning every attempt of every
  // endpoint on each update got slow on large runs.
  const recent = useMemo(
    () =>
      probing
        .flatMap((e) => e.attempts.slice(-4).map((a) => ({ a, host: safeHost(e.url) })))
        .sort((x, y) => y.a.timestamp - x.a.timestamp)
        .slice(0, 8),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run.endpoints]
  );

  const summary = useMemo(() => summarize(run.endpoints), [run.endpoints]);

  // The report joins to the connector directory when one is available: the open scrape, else the newest saved one.
  const generateReport = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      await openReport(async () => {
        let items: Item[] | null = getDirectory().items;
        if (items.length === 0) {
          try {
            const newest = (await listSnapshots())[0];
            items = newest ? await loadSnapshotItems(newest.id) : null;
          } catch {
            items = null; // history unavailable: the report is built without directory data
          }
        }
        const { html, asof } = generateProbeReportHtml(run.endpoints, items && items.length ? items : null, new Date(run.startedAt));
        return { html, fileName: probeReportFileName(asof) };
      });
    } finally {
      setGenerating(false);
    }
  };

  const onSelect = useCallback((e: { id: string }) => setSelectedId(e.id), []);
  const selected = run.endpoints.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Title and run status */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto min-w-0">
          <h1 className="text-2xl font-bold text-[#282728]">OAuth Client Registration Scanner</h1>
        </div>
        {isRunning ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm text-gray-700 shadow-sm">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-[#86BC25]" />
            Probing… {done} / {total}
          </span>
        ) : run.status === 'complete' ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-[#a7f3d0] bg-[#ecfdf5] px-4 py-1.5 text-sm font-semibold text-[#059669]" title="The probe finished">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#059669] text-white">
              <Icon d={ICONS.check} className="h-3 w-3" />
            </span>
            {total} endpoint{total === 1 ? '' : 's'} probed
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-sm font-semibold capitalize text-amber-700">
            {run.status} at {done} of {total}
          </span>
        )}
      </div>

      {/* Actions in a card, grouped by what they do, like the Claude page: run controls, then save and history, then the results. */}
      <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <ToolbarGroup label="Run">
        {isRunning ? (
          <button onClick={onCancel} className={look.secondary}>
            <Icon d={ICONS.stop} />
            Cancel
          </button>
        ) : (
          <button onClick={onRerun} disabled={busy} className={look.primary}>
            <Icon d={ICONS.refresh} />
            Re-run
          </button>
        )}
        <button
          onClick={() => {
            if (!saved && !window.confirm('This probe is not saved and will be lost. Leave without saving?')) return;
            onNewProbe();
          }}
          disabled={isRunning}
          className={look.secondary}
        >
          <Icon d={ICONS.plus} />
          New probe
        </button>
        </ToolbarGroup>
        <span className="hidden h-10 w-px self-end bg-gray-300 sm:block" aria-hidden="true" />
        <ToolbarGroup label="Keep">
        {saved ? (
          <span className={`${base} border border-gray-300 bg-white text-[#282728]`} title="Saved in Probe history">
            <Icon d={ICONS.check} className="h-4 w-4 text-[#6a9a1c]" />
            Saved
          </span>
        ) : (
          <button
            onClick={onSave}
            disabled={isRunning}
            title={isRunning ? 'Available when the run finishes' : 'Keep this probe in Probe history'}
            className={look.primary}
          >
            <Icon d={ICONS.save} />
            Save probe
          </button>
        )}
        <button onClick={onOpenHistory} className={look.secondary}>
          <Icon d={ICONS.clock} />
          Probe history
          <Count>{historyCount}</Count>
        </button>
        </ToolbarGroup>
        <span className="hidden h-10 w-px self-end bg-gray-300 sm:block" aria-hidden="true" />
        <ToolbarGroup label="Use the results">
        <button
          onClick={generateReport}
          disabled={isRunning || generating || summary.completed === 0}
          title={
            isRunning
              ? 'Available when the run finishes'
              : 'Open a dashboard of this probe in a new tab. Category, tier and launch-month views are included when a connector scrape is open or saved in Scraper history.'
          }
          className={look.secondary}
        >
          {generating ? (
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-[#86BC25]" />
          ) : (
            <Icon d={ICONS.report} />
          )}
          {generating ? 'Preparing…' : 'Generate report'}
        </button>
        <ExportButtons run={run} />
        </ToolbarGroup>
        {!saved && !isRunning && (
          <p className="basis-full text-sm font-semibold text-amber-700">Not saved — click Save probe to keep it in Probe history</p>
        )}
      </div>

      {/* The count is in the status pill above, so only the bar and the endpoints in flight are shown, and only while the run goes. */}
      {isRunning && (
        <div className="mt-5">
          <div className="h-2 bg-gray-200 rounded overflow-hidden">
            <div className="h-full bg-[#86BC25] transition-all" style={{ width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%` }} />
          </div>
          {probing.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {probing.map((e) => (
                <span key={e.id} className="text-xs px-2 py-1 rounded-full bg-[#a8d44e] text-[#282728] font-semibold animate-pulse">
                  Probing {displayName(e)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {summary.completed > 0 && <SummaryBar s={summary} running={isRunning} />}

      {isRunning && recent.length > 0 && (
        <div className="mt-5 bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 text-xs font-semibold text-[#282728] border-b border-gray-200">Live activity</div>
          <ul className="text-xs font-mono">
            {recent.map(({ a, host }) => {
              const dcr = a.stepLabel.includes('DCR');
              return (
                <li
                  key={a.id}
                  className={`px-3 py-1 flex gap-3 border-b border-gray-100 last:border-0 ${dcr ? 'bg-[#f0f7e6]' : ''}`}
                >
                  <span className={dcr ? 'text-[#5a7a1a] font-semibold' : 'text-gray-600'}>{a.stepLabel}</span>
                  <span className="text-gray-500 truncate">{host}</span>
                  <span className="ml-auto">{a.response?.status ?? '—'}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-6">
        <ResultsTable endpoints={run.endpoints} onSelect={onSelect} />
      </div>

      {selected && <DetailDrawer endpoint={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

const TILE_ICONS = {
  dcr: 'M15 19a5 5 0 0 0-10 0 M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M19 8v6 M16 11h6',
  cimd: 'M7 3h8l4 4v14H7z M15 3v4h4 M10 13h6 M10 17h4',
  app: 'M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z M9 12l2 2 4-4',
  unverified: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7 M12 17h.01',
};

type TileTone = 'green' | 'blue' | 'slate' | 'amber';
// Same colours as the probe report: a main colour, a second, a neutral and amber for "could not tell".
const TILE_TONES: Record<TileTone, { color: string; soft: string }> = {
  green: { color: '#86BC25', soft: '#f0f7e6' },
  blue: { color: '#4263EB', soft: '#edf0fd' },
  slate: { color: '#7A8499', soft: '#f1f3f7' },
  amber: { color: '#F59F00', soft: '#fff6e0' },
};

function Tile({ label = '', name, desc, value, of, tone, icon, hint }: { label?: string; name: string; desc: string; value: number; of: number; tone: TileTone; icon: string; hint?: string }) {
  const t = TILE_TONES[tone];
  const pct = of ? Math.round((value / of) * 100) : 0;
  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" title={hint}>
      <div className="h-1.5 shrink-0" style={{ background: t.color }} />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: t.soft, color: t.color }}>
            <Icon d={icon} className="h-6 w-6" />
          </span>
          <div className={`min-w-0 ${label ? '' : 'self-center'}`}>
            {label && <div className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: t.color }}>{label}</div>}
            <div className="text-sm font-semibold leading-snug text-[#282728]">{name}</div>
          </div>
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-4xl font-bold leading-none text-[#282728]">{value}</span>
          <span className="text-sm text-gray-400">of {of}</span>
          <span className="ml-auto rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: t.soft, color: t.color }}>{of ? `${pct}%` : '–'}</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: t.color }} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-gray-500">{desc}</p>
      </div>
    </div>
  );
}

function SummaryBar({ s, running }: { s: RunSummary; running: boolean }) {
  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-base font-bold text-[#282728]">Registration results{running ? ' so far' : ''}</h2>
        <span className="text-sm text-gray-500">
          {s.completed} of {s.total} endpoint{s.total === 1 ? '' : 's'} analysed
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="DCR" name="Dynamic Client Registration" desc="The server advertises a registration endpoint, so clients can register themselves." value={s.dcr} of={s.completed} tone="green" icon={TILE_ICONS.dcr} hint="Authorization server advertises a registration_endpoint (open or gated)" />
        <Tile label="CIMD" name="Client ID Metadata Documents" desc="The server accepts a URL as a client ID that points to a client metadata document." value={s.cimd} of={s.completed} tone="blue" icon={TILE_ICONS.cimd} hint="client_id_metadata_document_supported is true" />
        <Tile name="Pre-registered OAuth app" desc="OAuth found, but neither DCR nor CIMD. Likely a pre-registered app: contact the vendor (ISV) for details." value={s.preRegistered} of={s.completed} tone="slate" icon={TILE_ICONS.app} hint="OAuth signals found, but neither DCR nor CIMD, so access is likely through a pre-registered OAuth app. Not fully confirmed." />
        <Tile label="Unverified" name="Could not be confirmed" desc="Not OAuth, blocked at the edge or errored, so support could not be confirmed either way." value={s.unverified} of={s.completed} tone="amber" icon={TILE_ICONS.unverified} hint="Not OAuth, blocked at the edge, or errored: could not be confirmed either way" />
      </div>
    </div>
  );
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
