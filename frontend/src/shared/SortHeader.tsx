export type SortDir = '' | 'asc' | 'desc';

/** The order a column goes through when its heading is clicked: a date starts newest first, text starts A to Z. Then it goes back to the original order. */
export const nextSort = (cur: SortDir, kind: 'date' | 'text'): SortDir =>
  cur === '' ? (kind === 'date' ? 'desc' : 'asc') : cur === (kind === 'date' ? 'desc' : 'asc') ? (kind === 'date' ? 'asc' : 'desc') : '';

/** A column heading you click to sort. Two small triangles show the order, the one for the current direction lit. */
export function SortHeader({ label, dir, kind, onSort, className = 'px-3 py-2 whitespace-nowrap' }: { label: string; dir: SortDir; kind: 'date' | 'text'; onSort: () => void; className?: string }) {
  const first = kind === 'date' ? 'desc' : 'asc';
  const words = kind === 'date' ? { asc: 'Oldest first', desc: 'Newest first' } : { asc: 'A to Z', desc: 'Z to A' };
  const title =
    dir === ''
      ? `Click to sort, ${words[first].toLowerCase()}`
      : dir === first
      ? `${words[dir]}. Click for ${words[dir === 'asc' ? 'desc' : 'asc'].toLowerCase()}.`
      : `${words[dir]}. Click to remove the sorting.`;
  return (
    <th className={className} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
      <button onClick={onSort} title={title} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-white">
        {label}
        <svg aria-hidden="true" viewBox="0 0 10 14" className="h-3.5 w-2.5" fill="currentColor">
          <path d="M5 1 9 6H1z" className={dir === 'asc' ? '' : dir ? 'opacity-25' : 'opacity-45'} />
          <path d="M5 13 1 8h8z" className={dir === 'desc' ? '' : dir ? 'opacity-25' : 'opacity-45'} />
        </svg>
      </button>
    </th>
  );
}
