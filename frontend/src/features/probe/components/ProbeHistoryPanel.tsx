import { useState } from 'react';
import { probeNames, probeTitle } from '../lib/appName';
import { summarize } from '../lib/summary';
import { Shell } from '../../claude-scraper/ClaudeScraperModals';
import type { RunState } from '../lib/probeTypes';

interface Props {
  runs: RunState[];
  limit: number;
  busy: boolean;
  onClose: () => void;
  onView: (run: RunState) => void;
  onRerun: (run: RunState) => void;
  onDelete: (id: string) => void;
}

export default function HistoryPanel({ runs, limit, busy, onClose, onView, onRerun, onDelete }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <Shell
      titleId="probe-history-title"
      onClose={onClose}
      header={
        <>
          <h2 id="probe-history-title" className="font-bold text-[#282728]">Probe history</h2>
          <p className="text-xs text-gray-500">
            Probes you save with Save probe appear here, stored in this browser only. The newest {limit} are kept; saving a new one removes the oldest.
          </p>
        </>
      }
    >
      {runs.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">No saved probes yet. Run a probe, then click Save probe on its results page.</p>
      ) : (
        <ul className="space-y-2">
          {runs.map((r) => {
            const s = summarize(r.endpoints);
            return (
              <li key={r.id} className="border border-gray-200 rounded-lg p-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm text-[#282728] truncate">{probeTitle(r.endpoints)}</div>
                  {probeNames(r.endpoints, 4) && <div className="text-xs text-gray-600 truncate" title={probeNames(r.endpoints, 4)}>{probeNames(r.endpoints, 4)}</div>}
                  <div className="text-xs text-gray-500">
                    {new Date(r.startedAt).toLocaleString()} · {s.completed}/{s.total} done · {r.status}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    DCR {s.dcr} · CIMD {s.cimd} · Pre-registered OAuth app {s.preRegistered} · Unverified {s.unverified}
                  </div>
                </div>
                <div className="ml-auto flex gap-2">
                  <button onClick={() => onView(r)} className="px-3 py-1.5 text-sm rounded bg-[#86BC25] text-white font-semibold hover:bg-[#6a9a1c]">
                    View
                  </button>
                  <button
                    onClick={() => onRerun(r)}
                    disabled={busy}
                    className="px-3 py-1.5 text-sm rounded bg-[#f0f7e6] text-[#5a7a1a] font-semibold hover:bg-[#e3f0cc] disabled:opacity-40"
                  >
                    Re-run
                  </button>
                  {confirming === r.id ? (
                    <>
                      <button
                        onClick={() => {
                          setConfirming(null);
                          onDelete(r.id);
                        }}
                        className="px-3 py-1.5 text-sm rounded bg-red-600 text-white font-semibold"
                      >
                        Delete
                      </button>
                      <button onClick={() => setConfirming(null)} className="px-3 py-1.5 text-sm rounded border border-gray-300">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setConfirming(r.id)} className="px-3 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-100">
                      Delete
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}
