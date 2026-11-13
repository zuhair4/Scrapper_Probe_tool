// The toolbar look shared by the Claude, ChatGPT and Probe pages: one button size and a small set of looks,
// so the toolbars read as a single system.

export const ICONS = {
  refresh: 'M3 12a9 9 0 0 1 15.5-6.2L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-15.5 6.2L3 16 M3 21v-5h5',
  save: 'M5 4h11l3 3v13H5z M8 4v5h7V4 M8 20v-6h8v6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2',
  check: 'M5 12l5 5 9-10',
  upload: 'M12 16V5 M7 9l5-5 5 5 M5 20h14',
  live: 'M13 3L5 14h6l-1 7 8-11h-6z',
  copy: 'M9 9h10v11H9z M5 4h10v3 M5 4v12h3',
  stop: 'M7 7h10v10H7z',
  send: 'M5 12h14 M13 6l6 6-6 6',
  download: 'M12 4v11 M7 11l5 5 5-5 M5 20h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4',
  chevron: 'M6 9l6 6 6-6',
  plus: 'M12 5v14 M5 12h14',
  report: 'M7 3h8l4 4v14H7z M15 3v4h4 M10 13v4 M13 11v6 M16 14v3',
} as const;

export function Icon({ d, className = 'h-4 w-4' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export const base =
  'inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40';

export const look = {
  // Primary: the main actions. Secondary: everything else.
  primary: `${base} bg-[#86BC25] text-white shadow-sm hover:bg-[#6a9a1c]`,
  secondary: `${base} border border-gray-300 bg-white text-[#282728] hover:bg-gray-50`,
};

/** A small count shown inside a button. */
export function Count({ children, tone = 'light' }: { children: React.ReactNode; tone?: 'light' | 'onPrimary' }) {
  const tones = { light: 'bg-gray-100 text-gray-600', onPrimary: 'bg-white/25 text-white' };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tones[tone]}`}>{children}</span>;
}

/** A labelled set of buttons inside the actions card, as on the Claude, ChatGPT and Probe pages. */
export function ToolbarGroup({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">{label}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
