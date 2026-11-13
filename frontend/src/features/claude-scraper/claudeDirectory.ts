// Pure helpers for the Claude Directory Scraper. Every item field may be missing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Item = Record<string, any>;
export type Category = 'Connector' | 'Plugin' | 'Extension';

export const PROXY_BASE = '/proxy/api/directory/plugins';
export const REAL_ENDPOINT = 'https://api.anthropic.com/api/directory/plugins';

const VISIBILITY = 'commercial,enterprise,gsuite-google,gsuite-google-editors,public';
const VERIFIED_TIER = 'anthropic,partner,community';

export function baseParams(): URLSearchParams {
  return new URLSearchParams({ visibility: VISIBILITY, verified_tier: VERIFIED_TIER, limit: '500' });
}

export function lookupParams(id: string): URLSearchParams {
  return new URLSearchParams({
    visibility: VISIBILITY,
    verified_tier: VERIFIED_TIER,
    limit: '5',
    filter: `id == '${String(id).replace(/'/g, "\\'")}'`,
  });
}

export const TAXONOMY_FIELDS = ['object_acted_on', 'work_department', 'industry', 'life_area', 'subject'];
const PRIMARY_ORDER = ['work_department', 'industry', 'object_acted_on', 'life_area', 'subject'];

export function classify(item: Item): Category {
  const types = new Set<string>((item.components ?? []).map((c: Item) => c?.type));
  if (types.has('desktop_extension')) return 'Extension';
  // MCP-only packages that come from a plugin repository are Plugins, not Connectors.
  if (types.size === 1 && types.has('mcp_server') && !item.source?.repository) return 'Connector';
  return 'Plugin';
}

export function getRawType(item: Item): string {
  const types = [...new Set<string>((item.components ?? []).map((c: Item) => c?.type).filter(Boolean))].sort();
  return types.length ? types.join('+') : 'none';
}

export function taxValues(item: Item, field: string): string[] {
  const v = item.taxonomy?.[field];
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return [v];
}

export function allTaxValues(item: Item): string[] {
  return [...new Set(TAXONOMY_FIELDS.flatMap((f) => taxValues(item, f)))];
}

export function primaryTaxonomy(item: Item): string | null {
  for (const f of PRIMARY_ORDER) {
    const v = taxValues(item, f);
    if (v.length) return v[0];
  }
  return null;
}

export function humanize(slug: string): string {
  const s = String(slug).replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function getEndpoints(item: Item): string[] {
  const out: string[] = [];
  for (const c of item.components ?? []) {
    if (c?.type !== 'mcp_server' || !c.endpoint) continue;
    const e = c.endpoint;
    if (e.url) out.push(e.url);
    for (const o of e.options ?? []) if (o?.url) out.push(o.url);
    for (const h of e.hosts ?? []) out.push(`user-provided: https://${h}${e.path_prefix ?? ''}`);
    if (e.regex) out.push(`user-provided pattern: ${e.regex}`);
  }
  return [...new Set(out)];
}

// Probe-ready line ("url | name") for one item: its first http(s) MCP endpoint, the one the table
// shows first. Items with only user-provided hosts/patterns have no fixed URL and return null.
export function probeLineFor(item: Item): string | null {
  const url = getEndpoints(item).find(isHttp);
  if (!url) return null;
  const label = String(item.name || item.title || '').replace(/\|/g, '/').trim();
  return label ? `${url} | ${label}` : url;
}

// Items that have no fixed MCP URL, so they can't be sent to the probe.
export const unprobeableItems = (items: Item[]): Item[] => items.filter((i) => probeLineFor(i) === null);

const UNPROBEABLE_COLUMNS = [
  'Name', 'Publisher', 'Tier', 'Why not probeable', 'Allowed hosts', 'URL pattern (regex)',
  'Path prefix', 'Documentation', 'Summary', 'Taxonomy', 'Added', 'Updated', 'Directory ID',
];

function unprobeableReason(item: Item): string {
  const ep = (item.components ?? []).map((c: Item) => c?.endpoint).find(Boolean);
  if (!ep) return 'No endpoint details in directory';
  if (ep.regex) return 'URL pattern (regex)';
  if (ep.hosts) return 'Host list (user-provided)';
  return 'No fixed URL';
}

// CSV of the connectors that can't be probed, with everything useful we know about them.
export function buildUnprobeableCSV(items: Item[]): string {
  const q = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = items.map((it) => {
    const ep = (it.components ?? []).map((c: Item) => c?.endpoint).find(Boolean);
    return [
      it.name || it.title,
      it.publisher?.name,
      it.verified_tier,
      unprobeableReason(it),
      (ep?.hosts ?? []).join('; '),
      ep?.regex,
      ep?.path_prefix,
      ep?.documentation ?? it.links?.documentation,
      it.summary,
      allTaxValues(it).join('; '),
      it.added_time,
      it.updated_time,
      it.id,
    ]
      .map(q)
      .join(',');
  });
  return [UNPROBEABLE_COLUMNS.map(q).join(','), ...rows].join('\r\n');
}

// One line per probeable item, so the count matches the rows shown/exported minus the
// items that cannot be probed.
export function probeLinesFor(items: Item[]): string[] {
  return items.map(probeLineFor).filter((l): l is string => l !== null);
}

// The report files a connector under one level: department, industry, object acted on or life area.
const CATEGORY_LEVELS: Array<[string, string]> = [
  ['work_department', 'dept'],
  ['industry', 'industry'],
  ['object_acted_on', 'object'],
  ['life_area', 'life'],
];

/**
 * The taxonomy category an item is exported with (the taxonomy_category column), as "level:value", e.g. "dept:design".
 * Same form the Probe's CSV import produces. Items with no taxonomy have none.
 */
export function categoryForItem(item: Item): string | undefined {
  const value = primaryTaxonomy(item);
  if (!value) return undefined;
  const level = CATEGORY_LEVELS.find(([field]) => taxValues(item, field).includes(value))?.[1] ?? 'object';
  return `${level}:${value}`;
}

/** What Send to Probe hands over: the "url | name" lines, and the taxonomy category of each URL that has one. */
export function probeSendFor(items: Item[]): { lines: string[]; categories: Record<string, string> } {
  const lines: string[] = [];
  const categories: Record<string, string> = {};
  for (const item of items) {
    const line = probeLineFor(item);
    if (line === null) continue;
    lines.push(line);
    const category = categoryForItem(item);
    const url = getEndpoints(item).find(isHttp);
    if (category && url) categories[url] = category;
  }
  return { lines, categories };
}

export const shorten =(s: string, n = 42) => (s.length > n ? `${s.slice(0, n)}…` : s);
export const fmtDate = (t?: string | null) => (t ? String(t).slice(0, 10) : '—');
export function fmtDateTime(t?: string | null): string {
  if (!t) return '—';
  const d = new Date(t);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
export const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u);
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Retries network errors, 429 and 5xx forever with capped backoff; Stop is the escape hatch.
export async function fetchPage(
  params: URLSearchParams,
  stopRef: { current: boolean }
): Promise<Item | null> {
  let attempt = 0;
  for (;;) {
    if (stopRef.current) return null;
    try {
      const res = await fetch(`${PROXY_BASE}?${params}`);
      if (res.ok) return (await res.json()) as Item;
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`HTTP ${res.status} — ${res.statusText}`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('HTTP ')) throw e;
    }
    await sleep(Math.min(30000, 1000 * 2 ** Math.min(attempt, 5)));
    attempt++;
  }
}

const CSV_COLUMNS = [
  'id', 'name', 'slug', 'category', 'component_types', 'taxonomy_category',
  'object_acted_on', 'work_department', 'industry', 'life_area', 'subject',
  'publisher', 'verified_tier', 'summary', 'description', 'endpoint_url',
  'tools', 'documentation', 'added_time', 'updated_time',
];

export function buildCSV(items: Item[]): string {
  const q = (v: unknown) => `"${v == null ? '' : String(v).replace(/"/g, '""')}"`;
  const rows = items.map((it) => {
    const tools = (it.components ?? []).flatMap((c: Item) => (c?.tools ?? []).map((t: Item) => t?.name)).filter(Boolean);
    return [
      it.id,
      it.name || it.title,
      it.slug,
      classify(it),
      getRawType(it),
      primaryTaxonomy(it),
      ...['object_acted_on', 'work_department', 'industry', 'life_area', 'subject'].map((f) => taxValues(it, f).join('; ')),
      it.publisher?.name,
      it.verified_tier,
      it.summary,
      it.description,
      getEndpoints(it).join('; '),
      tools.join('; '),
      it.links?.documentation,
      it.added_time,
      it.updated_time,
    ].map(q).join(',');
  });
  return [CSV_COLUMNS.map(q).join(','), ...rows].join('\n');
}
