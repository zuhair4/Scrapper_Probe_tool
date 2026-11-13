import { useEffect, useRef, useState } from 'react';
import {
  Item,
  allTaxValues,
  classify,
  fmtDate,
  fmtDateTime,
  getEndpoints,
  getRawType,
  humanize,
  isHttp,
  lookupParams,
  probeLinesFor,
  probeSendFor,
  PROXY_BASE,
  TAXONOMY_FIELDS,
  taxValues,
} from './claudeDirectory';
import { HISTORY_LIMIT } from './claudeHistoryDb';
import type { SnapshotMeta } from './claudeHistoryDb';

export const CAT_CLASS: Record<string, string> = {
  Connector: 'bg-[#dcfce7] text-[#15803d]',
  Plugin: 'bg-[#ede9fe] text-[#6d28d9]',
  Extension: 'bg-[#ffedd5] text-[#c2410c]',
};

export function CatBadge({ cat }: { cat: string }) {
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CAT_CLASS[cat] ?? ''}`}>{cat}</span>;
}

// Escape / backdrop close, body scroll lock, focus on the close button.
function useModal(onClose: () => void) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return closeRef;
}

export function Shell({
  titleId,
  onClose,
  header,
  children,
}: {
  titleId: string;
  onClose: () => void;
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  const closeRef = useModal(onClose);
  return (
    <div
      className="fixed inset-0 z-50 bg-[rgba(15,23,42,.55)] flex items-end sm:items-center justify-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white w-full max-w-3xl max-h-[92vh] sm:max-h-[88vh] rounded-t-xl sm:rounded-xl shadow-2xl flex flex-col"
      >
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-200">
          <div className="min-w-0 flex-1">{header}</div>
          <button ref={closeRef} onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-black text-lg">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm break-words">{children}</div>
    </div>
  );
}

function Chip({ children, ok }: { children: React.ReactNode; ok?: boolean }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${ok ? 'bg-[#f0f7e6] text-[#5a7a1a]' : 'bg-gray-100 text-gray-700'}`}>
      {children}
    </span>
  );
}

export function ItemModal({
  item,
  onClose,
  onSendToProbe,
}: {
  item: Item;
  onClose: () => void;
  onSendToProbe: (lines: string[], categories?: Record<string, string>) => void;
}) {
  const [detail, setDetail] = useState<Item>(item);
  const [status, setStatus] = useState<'loading' | 'ok' | 'fallback'>('loading');
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${PROXY_BASE}?${lookupParams(item.id)}`, { signal: ctrl.signal });
        if (!res.ok) return setStatus('fallback');
        const json = await res.json();
        const found = (json?.data ?? [])[0];
        if (found) {
          setDetail(found);
          setStatus('ok');
        } else setStatus('fallback');
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setStatus('fallback');
      }
    })();
    return () => ctrl.abort();
  }, [item.id]);

  const d = detail;
  const cat = classify(d);
  const title = d.name || d.title || 'Untitled';
  const icon = d.media?.icons?.[0]?.url;
  const endpoints = getEndpoints(d);
  const tools: string[] = (d.components ?? []).flatMap((c: Item) => (c?.tools ?? []).map((t: Item) => t?.name)).filter(Boolean);
  const links = Object.entries(d.links ?? {}).filter(([, u]) => isHttp(u)) as [string, string][];
  const license = d.license == null ? null : typeof d.license === 'string' ? d.license : JSON.stringify(d.license);

  return (
    <Shell
      titleId="item-modal-title"
      onClose={onClose}
      header={
        <div className="flex items-center gap-3">
          {isHttp(icon) ? (
            <img src={icon} alt="" referrerPolicy="no-referrer" className="h-11 w-11 rounded-lg object-cover" />
          ) : (
            <div className="h-11 w-11 rounded-lg bg-gray-100 flex items-center justify-center font-bold text-gray-500">
              {title.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h2 id="item-modal-title" className="font-bold text-[#282728] truncate">{title}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-600">
              <CatBadge cat={cat} />
              {d.verified_tier && <Chip>{d.verified_tier}</Chip>}
              {d.publisher?.name && (
                <span>
                  by{' '}
                  {isHttp(d.publisher.url) ? (
                    <a href={d.publisher.url} target="_blank" rel="noopener noreferrer" className="underline">{d.publisher.name}</a>
                  ) : (
                    d.publisher.name
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      }
    >
      <div className="text-xs text-gray-500 mb-3 flex items-center gap-2">
        {status === 'loading' && (
          <>
            <span className="inline-block h-3 w-3 rounded-full border-2 border-gray-300 border-t-[#86BC25] animate-spin" />
            Fetching latest details…
          </>
        )}
        {status === 'ok' && 'Loaded fresh from the directory API'}
        {status === 'fallback' && 'Could not reach the API — showing data from the table fetch'}
      </div>

      {d.summary && <p className="text-sm mb-2">{d.summary}</p>}
      {d.description && d.description !== d.summary && (
        <p className="text-sm text-gray-600 mb-3 whitespace-pre-wrap">{d.description}</p>
      )}

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] mt-3">
        <Field label="Category">{cat}</Field>
        <Field label="Components">{getRawType(d)}</Field>
        <Field label="Publisher">{d.publisher?.name ?? '—'}</Field>
        <Field label="Tier">{d.verified_tier ?? '—'}</Field>
        <Field label="Added">{d.added_time ? `${fmtDate(d.added_time)} (${d.added_time})` : '—'}</Field>
        <Field label="Updated">{d.updated_time ? `${fmtDate(d.updated_time)} (${d.updated_time})` : '—'}</Field>
        <Field label="Slug"><code>{d.slug ?? '—'}</code></Field>
        <Field label="ID"><code>{d.id ?? '—'}</code></Field>
        {license && <Field label="License">{license}</Field>}
        {d.installation?.state && <Field label="Install state">{d.installation.state}</Field>}
      </div>

      <h3 className="text-xs uppercase font-bold text-[#5a7a1a] mt-5 mb-2">Taxonomy</h3>
      {allTaxValues(d).length === 0 ? (
        '—'
      ) : (
        <div className="space-y-1">
          {TAXONOMY_FIELDS.map((f) => {
            const v = taxValues(d, f);
            return v.length ? (
              <div key={f} className="flex flex-wrap items-center gap-1 text-xs">
                <span className="text-gray-500 w-36">{humanize(f.replace(/_/g, '-'))}</span>
                {v.map((x) => <Chip key={x}>{humanize(x)}</Chip>)}
              </div>
            ) : null;
          })}
        </div>
      )}

      {endpoints.length > 0 && (
        <>
          <h3 className="text-xs uppercase font-bold text-[#5a7a1a] mt-5 mb-2">MCP endpoint(s)</h3>
          {endpoints.map((e) => (
            <code key={e} className="block bg-gray-50 rounded px-2 py-1 mb-1 text-xs break-all">{e}</code>
          ))}
          {cat === 'Connector' && probeLinesFor([d]).length > 0 && (
            <button
              onClick={() => {
                const send = probeSendFor([d]);
                onSendToProbe(send.lines, send.categories);
              }}
              className="mt-2 px-3 py-1.5 text-sm rounded bg-[#86BC25] text-white font-semibold hover:bg-[#6a9a1c]"
            >
              Send to Probe
            </button>
          )}
        </>
      )}

      {tools.length > 0 && (
        <>
          <h3 className="text-xs uppercase font-bold text-[#5a7a1a] mt-5 mb-2">Tools ({tools.length})</h3>
          <div className="flex flex-wrap gap-1 font-mono">
            {tools.map((t, i) => <Chip key={`${t}-${i}`}>{t}</Chip>)}
          </div>
        </>
      )}

      {(d.compatibility ?? []).length > 0 && (
        <>
          <h3 className="text-xs uppercase font-bold text-[#5a7a1a] mt-5 mb-2">Compatibility</h3>
          <div className="flex flex-wrap gap-1">
            {(d.compatibility as Item[]).map((c, i) => (
              <Chip key={i} ok={c.state === 'works'}>{humanize(String(c.surface ?? '?'))}: {c.state}</Chip>
            ))}
          </div>
        </>
      )}

      {(d.tags ?? []).length > 0 && (
        <>
          <h3 className="text-xs uppercase font-bold text-[#5a7a1a] mt-5 mb-2">Tags</h3>
          <div className="flex flex-wrap gap-1">{(d.tags as string[]).map((t) => <Chip key={t}>{t}</Chip>)}</div>
        </>
      )}

      {links.length > 0 && (
        <>
          <h3 className="text-xs uppercase font-bold text-[#5a7a1a] mt-5 mb-2">Links</h3>
          <div className="flex flex-wrap gap-3 text-sm">
            {links.map(([k, u]) => (
              <a key={k} href={u} target="_blank" rel="noopener noreferrer" className="underline text-[#5a7a1a]">
                {humanize(k.replace(/_/g, '-'))}
              </a>
            ))}
          </div>
        </>
      )}

      <button onClick={() => setShowRaw((v) => !v)} className="mt-5 text-xs underline text-gray-600">
        {showRaw ? 'Hide raw JSON' : 'Show raw JSON'}
      </button>
      {showRaw && (
        <pre className="mt-2 bg-gray-50 rounded p-3 text-xs overflow-x-auto max-h-96">{JSON.stringify(detail, null, 2)}</pre>
      )}
    </Shell>
  );
}

export function HistoryModal({
  history,
  error,
  busyId,
  onClose,
  onView,
  onDelete,
}: {
  history: SnapshotMeta[];
  error: string | null;
  busyId: boolean;
  onClose: () => void;
  onView: (h: SnapshotMeta) => void;
  onDelete: (h: SnapshotMeta) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <Shell
      titleId="history-modal-title"
      onClose={onClose}
      header={
        <>
          <h2 id="history-modal-title" className="font-bold text-[#282728]">Scraper history</h2>
          <p className="text-xs text-gray-500">
            Scrapes you save with Save scrape appear here, stored in this browser only. The newest {HISTORY_LIMIT} are kept; saving a new one removes the oldest.
          </p>
        </>
      }
    >
      {error && <div className="mb-3 text-sm rounded border border-red-200 bg-red-50 text-red-700 px-3 py-2">{error}</div>}
      {history.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">
          No saved scrapes yet. After a fetch, click Save scrape to keep it here.
        </p>
      ) : (
        <ul className="space-y-2">
          {history.map((h) => (
            <li key={h.id} className="border border-gray-200 rounded-lg p-3 flex flex-wrap items-center gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-sm">{fmtDateTime(h.savedAt)}</div>
                <div className="text-xs text-gray-500">
                  {h.count} items{h.pages ? ` · ${h.pages} pages` : ''} · {h.connectors ?? 0} connectors · {h.plugins ?? 0} plugins · {h.extensions ?? 0} extensions
                </div>
              </div>
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => onView(h)}
                  disabled={busyId}
                  className="px-3 py-1.5 text-sm rounded bg-[#86BC25] text-white font-semibold hover:bg-[#6a9a1c] disabled:opacity-40"
                >
                  {busyId ? 'Loading…' : 'View'}
                </button>
                {confirming === h.id ? (
                  <>
                    <button
                      onClick={() => {
                        setConfirming(null);
                        onDelete(h);
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
                  <button onClick={() => setConfirming(h.id)} className="px-3 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-100">
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
