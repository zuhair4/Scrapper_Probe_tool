import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_SETTINGS } from '../lib/probeTypes';
import type { RunSettings } from '../lib/probeTypes';
import type { EndpointInput } from '../../../App';
import { endpointsFromCsv, guessColumns, readCsv } from '../lib/probeCsv';
import type { CsvColumns, CsvTable } from '../lib/probeCsv';

interface Props {
  historyCount: number;
  onOpenHistory: () => void;
  text: string;
  onTextChange: (text: string) => void;
  /** Category of each endpoint loaded from a CSV, by URL. */
  categories: Record<string, string>;
  onCategoriesChange: (categories: Record<string, string>) => void;
  busy: boolean;
  onStart: (inputs: EndpointInput[], settings: RunSettings, label?: string) => void;
}

function parseInput(text: string): { valid: EndpointInput[]; invalid: string[] } {
  const valid: EndpointInput[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    // Accepts "Name | URL" and "URL | Name"
    const bar = line.indexOf('|');
    let urlPart = line;
    let label: string | undefined;
    if (bar !== -1) {
      const left = line.slice(0, bar).trim();
      const right = line.slice(bar + 1).trim();
      const leftIsUrl = /^https?:\/\//i.test(left);
      urlPart = leftIsUrl ? left : right;
      label = (leftIsUrl ? right : left) || undefined;
    }
    try {
      const u = new URL(urlPart);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol');
      if (seen.has(urlPart)) continue;
      seen.add(urlPart);
      valid.push({ url: urlPart, label });
    } catch {
      invalid.push(line);
    }
  }
  return { valid, invalid };
}

interface CsvFile {
  name: string;
  table: CsvTable;
  cols: CsvColumns;
}

function ColumnSelect({ label, value, headers, none, onChange }: { label: string; value: number; headers: string[]; none: string; onChange: (i: number) => void }) {
  return (
    <label className="block text-xs font-semibold text-gray-600">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 block w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm font-normal text-[#282728] focus:outline-none focus:ring-2 focus:ring-[#86BC25]"
      >
        <option value={-1}>{none}</option>
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `(column ${i + 1})`}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function InputPage({ text, onTextChange: setText, categories, onCategoriesChange, busy, onStart, historyCount, onOpenHistory }: Props) {
  const { valid, invalid } = useMemo(() => parseInput(text), [text]);
  const [csv, setCsv] = useState<CsvFile | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  // An emptied box starts over, so categories of endpoints that are gone do not linger.
  useEffect(() => {
    if (!text.trim() && Object.keys(categories).length > 0) onCategoriesChange({});
  }, [text, categories, onCategoriesChange]);

  const [firstOnly, setFirstOnly] = useState(false);
  const preview = useMemo(() => (csv ? endpointsFromCsv(csv.table, csv.cols, { firstUrlOnly: firstOnly }) : null), [csv, firstOnly]);
  // How many URLs the file lists beyond the first of each connector (regional copies).
  const regionalCopies = useMemo(() => (csv ? endpointsFromCsv(csv.table, csv.cols, { firstUrlOnly: true }).extraUrls : 0), [csv]);
  const withCategory = valid.filter((v) => categories[v.url]).length;

  const loadCsv = async (file: File | undefined) => {
    if (!file) return;
    setCsvError(null);
    try {
      const table = readCsv(await file.text());
      if (!table) {
        setCsv(null);
        setCsvError(`${file.name}: no data rows found. The first line must be the column names.`);
        return;
      }
      setFirstOnly(false);
      setCsv({ name: file.name, table, cols: guessColumns(table.headers) });
    } catch {
      setCsv(null);
      setCsvError(`${file.name}: could not be read as a CSV file.`);
    }
  };

  const addCsvEndpoints = () => {
    if (!preview) return;
    const have = new Set(valid.map((v) => v.url));
    const fresh = preview.endpoints.filter((e) => !have.has(e.url));
    const lines = fresh.map((e) => (e.label ? `${e.url} | ${e.label}` : e.url));
    if (lines.length) setText(text.trim() ? `${text.replace(/\s+$/, '')}\n${lines.join('\n')}` : lines.join('\n'));
    // Also for endpoints already in the box, so a category is never left behind.
    const next = { ...categories };
    for (const e of preview.endpoints) if (e.category) next[e.url] = e.category;
    onCategoriesChange(next);
    setCsv(null);
  };

  const setCol = (key: keyof CsvColumns, i: number) => setCsv((c) => (c ? { ...c, cols: { ...c.cols, [key]: i } } : c));

  const start = () => onStart(valid.map((v) => ({ ...v, category: categories[v.url] })), DEFAULT_SETTINGS);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="flex items-start gap-4">
        <h1 className="text-2xl font-bold text-[#282728]">OAuth Client Registration Scanner</h1>
        <button
          onClick={onOpenHistory}
          className="ml-auto shrink-0 inline-flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium border border-gray-300 bg-white hover:bg-gray-50"
        >
          Probe history
          <span className="text-xs px-1.5 rounded-full bg-gray-100 text-gray-600">{historyCount}</span>
        </button>
      </div>
      <p className="text-gray-600 mt-2 text-sm">
        Paste MCP endpoint URLs, one per line, as <code className="bg-gray-100 px-1 rounded">MCP Endpoint | Name</code> (the name is optional and is looked up if left out), or
        upload a CSV. Each endpoint is checked for its challenge, protected resource metadata, authorization server metadata and one dynamic client registration attempt.
      </p>

      <div className="bg-white border border-gray-200 rounded-lg mt-6 p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-1">
          <label htmlFor="endpoints" className="block text-sm font-semibold text-[#282728]">Endpoints</label>
          <label
            className={`ml-auto inline-flex items-center gap-2 px-3 py-1 rounded-md text-sm font-medium border border-gray-300 bg-white hover:bg-gray-50 cursor-pointer ${busy ? 'pointer-events-none opacity-40' : ''}`}
            title="A CSV with a column of MCP endpoint URLs, such as the Claude scraper's export"
          >
            Upload CSV…
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                void loadCsv(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        {csvError && <div className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{csvError}</div>}

        {csv && preview && (
          <div className="mb-3 rounded-lg border border-[#dcebc0] bg-[#f0f7e6] p-4 text-sm">
            <div className="font-semibold text-[#282728]">
              {csv.name} <span className="font-normal text-gray-600">· {csv.table.rows.length.toLocaleString()} rows</span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <ColumnSelect label="MCP endpoint column" value={csv.cols.endpoint} headers={csv.table.headers} none="(choose a column)" onChange={(i) => setCol('endpoint', i)} />
              <ColumnSelect label="Name column" value={csv.cols.name} headers={csv.table.headers} none="(none: look the name up)" onChange={(i) => setCol('name', i)} />
              <ColumnSelect label="Category column" value={csv.cols.category} headers={csv.table.headers} none="(none: no category)" onChange={(i) => setCol('category', i)} />
            </div>
            <div className="mt-3 text-xs text-gray-700">
              {csv.cols.endpoint < 0 ? (
                'Pick the column that holds the MCP endpoint URLs.'
              ) : (
                <>
                  <b>{preview.endpoints.length.toLocaleString()}</b> endpoints found
                  {csv.cols.category >= 0 && <> · <b>{preview.withCategory.toLocaleString()}</b> with a category</>}
                  {preview.noUrl > 0 && <> · {preview.noUrl.toLocaleString()} rows skipped (no fixed URL to probe)</>}
                  {preview.duplicates > 0 && <> · {preview.duplicates.toLocaleString()} duplicate URLs</>}
                </>
              )}
            </div>
            {csv.cols.endpoint >= 0 && regionalCopies > 0 && (
              <label className="mt-2 flex items-start gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={firstOnly} onChange={(e) => setFirstOnly(e.target.checked)} className="mt-0.5 accent-[#86BC25]" />
                <span>
                  Only the first URL of each connector. Some connectors list several (for example one per region); every URL is a separate server, so by default all are probed,
                  each named by its host, e.g. “Zoho Desk (claude-zohodesk.zohomcp.eu)”. {regionalCopies.toLocaleString()} {regionalCopies === 1 ? 'URL' : 'URLs'} in this file are not first URLs.
                </span>
              </label>
            )}
            {preview.endpoints.length > 500 && (
              <div className="mt-2 text-xs text-amber-700">
                {preview.endpoints.length.toLocaleString()} endpoints will take a while to probe. You can delete lines from the box below after adding them.
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={addCsvEndpoints}
                disabled={preview.endpoints.length === 0}
                className="px-4 py-1.5 rounded bg-[#86BC25] text-sm font-semibold text-white hover:bg-[#6a9a1c] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add {preview.endpoints.length.toLocaleString()} endpoints
              </button>
              <button onClick={() => setCsv(null)} className="px-4 py-1.5 rounded border border-gray-300 bg-white text-sm hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mb-1 font-mono text-xs font-semibold text-gray-500" aria-hidden="true">MCP Endpoint | Name</div>
        <textarea
          id="endpoints"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          spellCheck={false}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#86BC25]"
          placeholder={'MCP Endpoint | Name\nhttps://mcp.example.com/mcp | Example\nhttps://api.vendor.com/mcp'}
        />
        <div className="text-xs mt-1 flex flex-wrap gap-x-4">
          <span className="text-gray-500">{valid.length.toLocaleString()} valid endpoint{valid.length === 1 ? '' : 's'}</span>
          {withCategory > 0 && (
            <span className="text-gray-500" title="Loaded from a CSV. Saved with the run, shown in its results, exported, and used in the report.">
              {withCategory.toLocaleString()} with a category
            </span>
          )}
          {invalid.length > 0 && (
            <span className="text-red-600" title={invalid.join('\n')}>
              {invalid.length} invalid line{invalid.length === 1 ? '' : 's'} will be skipped
            </span>
          )}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={start}
            disabled={busy || valid.length === 0}
            className="px-5 py-2 rounded bg-[#86BC25] text-white font-semibold hover:bg-[#6a9a1c] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start probe
          </button>
          {busy && <span className="text-sm text-gray-500">A run is already in progress.</span>}
        </div>
      </div>
    </div>
  );
}
