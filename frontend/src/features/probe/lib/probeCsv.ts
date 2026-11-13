import { parseCsv } from '../../../shared/csv';

// Picks MCP endpoints (and, optionally, their category) out of a CSV such as the Claude scraper's export.

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

/** Which column holds what, as an index into the headers; -1 when there is none. */
export interface CsvColumns {
  endpoint: number;
  name: number;
  category: number;
}

export interface CsvEndpoint {
  url: string;
  label?: string;
  /** "level:value" as the probe report groups it, e.g. "dept:design" or "object:files-documents". */
  category?: string;
}

export interface CsvImport {
  endpoints: CsvEndpoint[];
  /** Data rows in the file. */
  rows: number;
  /** Rows with no fixed http(s) URL (empty, or a user-provided host or pattern), so nothing to probe. */
  noUrl: number;
  /** URLs already taken from an earlier row. */
  duplicates: number;
  withCategory: number;
  /** Further URLs listed in the same cell as the one taken (regional copies of one connector). Only counted with firstUrlOnly. */
  extraUrls: number;
}

export interface CsvImportOptions {
  /** Take only the first URL of a cell, one endpoint per connector. By default every URL is taken. */
  firstUrlOnly?: boolean;
}

export function readCsv(text: string): CsvTable | null {
  const all = parseCsv(text);
  if (all.length < 2) return null;
  return { headers: all[0].map((h) => h.trim()), rows: all.slice(1) };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, ' ');

const ENDPOINT_HEADERS = ['endpoint url', 'endpoint urls', 'mcp endpoint url', 'mcp endpoint urls', 'mcp endpoint', 'mcp url', 'endpoint', 'url'];
const NAME_HEADERS = ['name', 'plugin', 'connector', 'label', 'title'];
// Only the taxonomy is picked automatically. A plain "category" column is not: in the Claude export it only says
// Connector, Plugin or Extension. Any other column can still be chosen by hand.
const CATEGORY_HEADERS = ['taxonomy category'];

const findHeader = (headers: string[], names: string[]) => {
  const h = headers.map(norm);
  for (const n of names) {
    const i = h.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
};

export function guessColumns(headers: string[]): CsvColumns {
  return { endpoint: findHeader(headers, ENDPOINT_HEADERS), name: findHeader(headers, NAME_HEADERS), category: findHeader(headers, CATEGORY_HEADERS) };
}

// The report files each connector under one level: department, else industry, else object acted on, else life area.
const LEVEL_HEADERS: Array<[string, 'dept' | 'industry' | 'object' | 'life']> = [
  ['work department', 'dept'],
  ['industry', 'industry'],
  ['object acted on', 'object'],
  ['life area', 'life'],
];

const firstValue = (v: string) => v.split(';')[0].trim();

/**
 * "level:value" for a category cell. The level is the first of department, industry, object, life area whose column in
 * the same row holds that value; with none (or no such columns) it is "object".
 */
export function categoryKey(value: string, row: string[], headers: string[]): string {
  const v = firstValue(value);
  if (!v) return '';
  for (const [header, level] of LEVEL_HEADERS) {
    const i = findHeader(headers, [header]);
    if (i >= 0 && (row[i] ?? '').split(';').some((x) => x.trim() === v)) return `${level}:${v}`;
  }
  return `object:${v}`;
}

/** "files-documents" -> "Files documents"; accepts the "level:value" form. */
export function categoryLabel(key: string): string {
  const v = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
  return v ? v.charAt(0).toUpperCase() + v.slice(1).replace(/-/g, ' ') : '';
}

const FIXED_URL = /^https?:\/\/[^\s*]+$/i;

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function endpointsFromCsv(table: CsvTable, cols: CsvColumns, opts: CsvImportOptions = {}): CsvImport {
  const out: CsvImport = { endpoints: [], rows: table.rows.length, noUrl: 0, duplicates: 0, withCategory: 0, extraUrls: 0 };
  if (cols.endpoint < 0) return out;
  const seen = new Set<string>();
  for (const row of table.rows) {
    // A cell may hold several URLs separated by ";". Entries such as "user-provided: https://*.example.com" are not fixed URLs.
    const all = (row[cols.endpoint] ?? '')
      .split(';')
      .map((u) => u.trim())
      .filter((u) => FIXED_URL.test(u));
    if (all.length === 0) {
      out.noUrl++;
      continue;
    }
    // A connector can list several URLs (e.g. one per region). Each is its own server, so by default each is taken, named by its host.
    const urls = opts.firstUrlOnly ? all.slice(0, 1) : all;
    out.extraUrls += all.length - urls.length;
    const name = cols.name >= 0 ? (row[cols.name] ?? '').replace(/\|/g, '/').trim() : '';
    const category = cols.category >= 0 ? categoryKey(row[cols.category] ?? '', row, table.headers) : '';
    for (const url of urls) {
      if (seen.has(url)) {
        out.duplicates++;
        continue;
      }
      seen.add(url);
      const label = name && urls.length > 1 ? `${name} (${hostOf(url)})` : name;
      out.endpoints.push({ url, label: label || undefined, category: category || undefined });
      if (category) out.withCategory++;
    }
  }
  return out;
}
