import { useState } from 'react';
import { Shell } from '../claude-scraper/ClaudeScraperModals';
import { fmtDateTime } from '../claude-scraper/claudeDirectory';
import { HISTORY_LIMIT } from './chatgptHistoryDb';
import type { SnapshotMeta } from './chatgptHistoryDb';

export default function HistoryModal({
  history,
  error,
  busy,
  onClose,
  onView,
  onDelete,
}: {
  history: SnapshotMeta[];
  error: string | null;
  busy: boolean;
  onClose: () => void;
  onView: (h: SnapshotMeta) => void;
  onDelete: (h: SnapshotMeta) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <Shell
      titleId="chatgpt-history-title"
      onClose={onClose}
      header={
        <>
          <h2 id="chatgpt-history-title" className="font-bold text-[#282728]">ChatGPT scrape history</h2>
          <p className="text-xs text-gray-500">
            Scrapes you save with Save scrape appear here, stored in this browser only. The newest {HISTORY_LIMIT} are kept; saving a new one removes the oldest.
          </p>
        </>
      }
    >
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {history.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">No saved scrapes yet. After a fetch, click Save scrape to keep it here.</p>
      ) : (
        <ul className="space-y-2">
          {history.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 p-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{fmtDateTime(h.savedAt)}</div>
                <div className="text-xs text-gray-500">
                  {h.count.toLocaleString()} plugins · {h.categories} categories · {h.withDetails.toLocaleString()} with details · {h.remoteEndpoints.toLocaleString()} with a remote endpoint
                </div>
              </div>
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => onView(h)}
                  disabled={busy}
                  className="rounded bg-[#86BC25] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#6a9a1c] disabled:opacity-40"
                >
                  {busy ? 'Loading…' : 'View'}
                </button>
                {confirming === h.id ? (
                  <>
                    <button
                      onClick={() => {
                        setConfirming(null);
                        onDelete(h);
                      }}
                      className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white"
                    >
                      Delete
                    </button>
                    <button onClick={() => setConfirming(null)} className="rounded border border-gray-300 px-3 py-1.5 text-sm">
                      Cancel
                    </button>
                  </>
                ) : (
                  <button onClick={() => setConfirming(h.id)} className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100">
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
