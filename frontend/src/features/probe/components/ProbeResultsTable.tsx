import { memo, useMemo, useState } from 'react';
import type { EndpointResult } from '../lib/probeTypes';
import { dcrState, isCimd } from '../lib/summary';
import { displayName } from '../lib/appName';
import { categoryLabel } from '../lib/probeCsv';
import { Icon, ICONS } from '../../../shared/toolbar';
import { MultiSelectFilter } from '../../../shared/MultiSelectFilter';
import type { FilterOption } from '../../../shared/MultiSelectFilter';

interface Props {
  endpoints: EndpointResult[];
  onSelect: (e: EndpointResult) => void;
}

export function statusOf(e: EndpointResult): { text: string; cls: string } {
  if (!e.completedAt) {
    return e.startedAt > 0
      ? { text: 'Probing…', cls: 'bg-[#a8d44e] text-[#282728]' }
      : { text: 'Pending', cls: 'bg-gray-200 text-gray-600' };
  }
  return e.classification.status === 'complete'
    ? { text: 'Complete', cls: 'bg-[#f0f7e6] text-[#5a7a1a]' }
    : { text: 'Not complete', cls: 'bg-gray-200 text-gray-700' };
}

export function dcrOpen(e: EndpointResult): boolean | undefined {
  const r = e.dcrResults[0];
  if (!r) return undefined;
  return r.status === 200 || r.status === 201;
}

export function flagsOf(e: EndpointResult): string[] {
  const c = e.classification;
  const flags: string[] = [];
  if (e.prm.resourceMismatch) flags.push('PRM resource mismatch');
  if (e.as.issuerMismatch) flags.push('issuer mismatch');
  if (c.scopesMismatch) flags.push('scopes mismatch');
  if (c.multipleHosts) flags.push('multiple hosts');
  if (c.missingRefreshToken) flags.push('no refresh_token');
  if (c.hasPlainPKCE) flags.push('PKCE plain');
  if (c.apiKeyHint) flags.push('API key hint');
  for (const g of c.notableGrants) flags.push(g);
  return flags;
}

const yn = (v: boolean, title?: string) =>
  v ? (
    <span className="text-[#5a7a1a] font-semibold" title={title}>Yes</span>
  ) : (
    <span className="text-gray-400" title={title}>No</span>
  );

const NAME_SOURCE_HINT: Record<string, string> = {
  'PRM resource_name': 'Name from the protected resource metadata',
  'MCP serverInfo': 'Name reported by the MCP server',
  'WWW-Authenticate realm': 'Name from the WWW-Authenticate realm',
  hostname: 'Guessed from the hostname',
};

// Memoized: during a run only the endpoint being updated gets a new object, so the
// other rows skip rendering instead of the whole table re-rendering on every request.
const Row = memo(function Row({
  e,
  index,
  showCategory,
  onSelect,
}: {
  e: EndpointResult;
  index: number;
  showCategory: boolean;
  onSelect: (e: EndpointResult) => void;
}) {
  const st = statusOf(e);
  const c = e.classification;
  const oauth = !!e.completedAt && c.status === 'complete';
  const dcr = dcrState(e);
  const regEndpoint = oauth ? e.as.metadata?.registration_endpoint : undefined;
  const dcrHint =
    dcr === 'open'
      ? 'Registration succeeded without credentials'
      : dcr === 'gated'
        ? `registration_endpoint advertised, but the probe was gated${e.dcrResults[0]?.status ? ` (HTTP ${e.dcrResults[0].status})` : ''}`
        : undefined;
  const nameHint = e.label ? 'Name you entered' : NAME_SOURCE_HINT[e.appNameSource ?? 'hostname'];

  return (
    <tr onClick={() => onSelect(e)} className="border-t border-gray-100 hover:bg-[#f0f7e6] cursor-pointer">
      <td className="px-3 py-2 text-[#86BC25] font-bold">{index + 1}</td>
      <td className="px-3 py-2 max-w-[220px]">
        <div className="font-semibold text-[#282728] truncate" title={nameHint}>{displayName(e)}</div>
      </td>
      <td className="px-3 py-2 max-w-xs">
        <div className="font-mono text-xs text-gray-600 truncate" title={e.url}>{e.url}</div>
      </td>
      {showCategory && (
        <td className="px-3 py-2 whitespace-nowrap">
          {e.category ? (
            <span className="text-xs px-2 py-0.5 rounded bg-[#f0f7e6] text-[#5a7a1a] font-semibold" title={e.category.replace(':', ': ')}>
              {categoryLabel(e.category)}
            </span>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>
      )}
      <td className="px-3 py-2">{oauth ? yn(dcr !== 'none', dcrHint) : '—'}</td>
      <td className="px-3 py-2">{oauth ? yn(isCimd(e)) : '—'}</td>
      <td className="px-3 py-2 max-w-[260px]">
        {typeof regEndpoint === 'string' ? (
          <div className="font-mono text-xs text-gray-600 truncate" title={regEndpoint}>{regEndpoint}</div>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${st.cls}`} title={c.statusNote ?? e.error}>
          {st.text}
        </span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <button
          onClick={(ev) => {
            ev.stopPropagation();
            onSelect(e);
          }}
          className="px-3 py-1 text-xs rounded bg-[#f0f7e6] text-[#5a7a1a] font-semibold hover:bg-[#e3f0cc]"
          title="See every API call, request and response for this endpoint"
        >
          Details{e.attempts.length > 0 ? ` (${e.attempts.length})` : ''}
        </button>
      </td>
    </tr>
  );
});

type Answer = '' | 'yes' | 'no';
const NO_CATEGORY = '__none__';

/** What the DCR and CIMD columns show for an endpoint: Yes or No, or nothing ("–") when the probe got no OAuth answer. */
const answerOf = (e: EndpointResult, yes: (e: EndpointResult) => boolean): Exclude<Answer, ''> | null =>
  !!e.completedAt && e.classification.status === 'complete' ? (yes(e) ? 'yes' : 'no') : null;

export default function ResultsTable({ endpoints, onSelect }: Props) {
  const showCategory = endpoints.some((e) => e.category);
  const [query, setQuery] = useState('');
  // Filters. Empty means all. Ticked categories match if an endpoint has any of them.
  const [fDcr, setFDcr] = useState<Answer>('');
  const [fCimd, setFCimd] = useState<Answer>('');
  const [fCats, setFCats] = useState<string[]>([]);
  // Unverified: the probe finished without an OAuth answer (not OAuth, blocked at the edge or errored).
  const [fUnverified, setFUnverified] = useState(false);

  // The categories the endpoints have, and whether some have none.
  const catOptions = useMemo<FilterOption[]>(() => {
    const keys = [...new Set(endpoints.map((e) => e.category).filter((c): c is string => !!c))].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)));
    const noneToo = endpoints.some((e) => !e.category);
    return [...(noneToo ? [{ value: NO_CATEGORY, label: 'No category', none: true }] : []), ...keys.map((k) => ({ value: k, label: categoryLabel(k) }))];
  }, [endpoints]);

  // The search looks in the app name and the category, as shown in the table. The # column keeps each row's place in the full list.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return endpoints
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => {
        if (fDcr && answerOf(e, (x) => dcrState(x) !== 'none') !== fDcr) return false;
        if (fCimd && answerOf(e, isCimd) !== fCimd) return false;
        if (fCats.length && !fCats.includes(e.category || NO_CATEGORY)) return false;
        if (fUnverified && !(e.completedAt && e.classification.status !== 'complete')) return false;
        return !q || `${displayName(e)} ${e.category ? categoryLabel(e.category) : ''}`.toLowerCase().includes(q);
      });
  }, [endpoints, query, fDcr, fCimd, fCats, fUnverified]);

  const activeFilters = [fDcr, fCimd, fCats.length > 0, fUnverified].filter(Boolean).length;
  const filtering = !!query.trim() || activeFilters > 0;
  const clearFilters = () => {
    setFDcr('');
    setFCimd('');
    setFCats([]);
    setFUnverified(false);
  };
  const LABEL = 'block text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400';
  const SELECT =
    'mt-1 block h-9 w-40 rounded-lg border border-gray-300 bg-white px-2 text-sm font-normal normal-case tracking-normal text-[#282728] focus:outline-none focus:ring-2 focus:ring-[#86BC25]';
  const answerSelect = (value: Answer, set: (v: Answer) => void, label: string) => (
    <label className={LABEL}>
      {label}
      <select value={value} onChange={(ev) => set(ev.target.value as Answer)} className={SELECT}>
        <option value="">All</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );

  return (
    <div>
      {/* Search and filters share one card and one row, like the Claude page. */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <Icon d={ICONS.search} />
            </span>
            <input
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              aria-label="Search results"
              placeholder={showCategory ? 'Search app name or category…' : 'Search app name…'}
              className="h-9 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#86BC25] sm:w-72"
            />
          </div>
          {answerSelect(fDcr, setFDcr, 'DCR')}
          {answerSelect(fCimd, setFCimd, 'CIMD')}
          {showCategory && (
            <div className={LABEL}>
              Category
              <MultiSelectFilter options={catOptions} value={fCats} onChange={setFCats} noun="category" nounPlural="categories" />
            </div>
          )}
          <div className="flex h-9 items-center gap-4 text-sm text-gray-700">
            <label className="inline-flex items-center gap-1.5 whitespace-nowrap" title="The probe finished without an OAuth answer: not OAuth, blocked at the edge or errored. Shown as Not complete in the Status column.">
              <input type="checkbox" checked={fUnverified} onChange={(ev) => setFUnverified(ev.target.checked)} className="accent-[#86BC25]" />
              Unverified
            </label>
          </div>
          <div className="ml-auto flex h-9 items-center gap-4 text-sm">
            {activeFilters > 0 && (
              <button onClick={clearFilters} className="whitespace-nowrap font-semibold text-[#5a7a1a] underline">
                Clear filters ({activeFilters})
              </button>
            )}
            <span className="whitespace-nowrap text-gray-500">{filtering ? `${rows.length} of ${endpoints.length}` : `${endpoints.length} endpoint${endpoints.length === 1 ? '' : 's'}`}</span>
          </div>
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#282728] text-[#86BC25] text-left text-xs uppercase tracking-wide">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Endpoint</th>
              {showCategory && <th className="px-3 py-2">Category</th>}
              <th className="px-3 py-2">DCR</th>
              <th className="px-3 py-2">CIMD</th>
              <th className="px-3 py-2">DCR endpoint</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={showCategory ? 9 : 8} className="px-3 py-8 text-center text-gray-500">
                  No results match {query.trim() ? <>“{query.trim()}”</> : 'the filters'}
                  {query.trim() && activeFilters > 0 ? ' and the filters' : ''}.
                </td>
              </tr>
            )}
            {rows.map(({ e, i }) => (
              <Row key={e.id} e={e} index={i} showCategory={showCategory} onSelect={onSelect} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
