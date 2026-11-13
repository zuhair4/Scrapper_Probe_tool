import { useEffect, useMemo, useRef, useState } from 'react';

export interface FilterOption {
  value: string;
  label: string;
  /** Shown on hover. */
  hint?: string;
  /** Set for a "none of these" choice: shown in italics, first in the list, and left out of the find box's results. */
  none?: boolean;
}

interface Props {
  options: FilterOption[];
  /** The ticked values. Empty means all. */
  value: string[];
  onChange: (next: string[]) => void;
  /** What one is called, for the find box and the summary: "category" gives "Find a category…" and "3 categories". */
  noun: string;
  nounPlural: string;
  /** Width of the button, as a Tailwind class. */
  width?: string;
}

/** A dropdown of checkboxes: tick as many as you like, and a row matches if it has any of them. */
export function MultiSelectFilter({ options, value, onChange, noun, nounPlural, width = 'w-52' }: Props) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const q = find.trim().toLowerCase();
  const shown = useMemo(
    () => options.filter((o) => (q ? !o.none && o.label.toLowerCase().includes(q) : true)),
    [options, q]
  );

  const picked = new Set(value);
  const toggle = (v: string) => onChange(picked.has(v) ? value.filter((x) => x !== v) : [...value, v]);

  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const summary = value.length === 0 ? 'All' : value.length <= 2 ? value.map(labelOf).join(', ') : `${value.length} ${nounPlural}`;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={value.length > 2 ? value.map(labelOf).join(', ') : undefined}
        className={`mt-1 flex h-9 ${width} items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-2 text-left text-sm font-normal normal-case tracking-normal text-[#282728] focus:outline-none focus:ring-2 focus:ring-[#86BC25]`}
      >
        <span className={`truncate ${value.length ? 'font-semibold text-[#5a7a1a]' : ''}`}>{summary}</span>
        <svg aria-hidden="true" viewBox="0 0 10 6" className={`h-2 w-2.5 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 max-w-[85vw] rounded-lg border border-gray-200 bg-white p-2 text-sm font-normal normal-case tracking-normal text-[#282728] shadow-lg">
          <input
            autoFocus
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder={`Find a ${noun}…`}
            aria-label={`Find a ${noun}`}
            className="mb-2 h-8 w-full rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#86BC25]"
          />
          <div role="listbox" aria-multiselectable="true" className="max-h-64 overflow-y-auto">
            {shown.map((o) => (
              <label key={o.value} title={o.hint} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-[#f0f7e6]">
                <input type="checkbox" checked={picked.has(o.value)} onChange={() => toggle(o.value)} className="accent-[#86BC25]" />
                <span className={o.none ? 'italic text-gray-600' : ''}>{o.label}</span>
              </label>
            ))}
            {shown.length === 0 && <div className="px-2 py-3 text-center text-gray-500">No {noun} matches “{find.trim()}”.</div>}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 text-xs">
            <span className="text-gray-500">{value.length ? `${value.length} selected` : 'None selected = all'}</span>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={value.length === 0}
              className="font-semibold text-[#5a7a1a] underline disabled:text-gray-400 disabled:no-underline"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
