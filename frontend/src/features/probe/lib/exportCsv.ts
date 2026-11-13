import type { EndpointResult, RunState } from './probeTypes';
import { dcrState, isCimd } from './summary';
import { displayName } from './appName';
import { summarizeDetails } from './details';
import { statusOf } from '../components/ProbeResultsTable';

// Same fields, in the same order, as the results table.
export const CSV_COLUMNS = [
  'Name',
  'MCP Endpoint',
  'Category',
  'DCR',
  'CIMD',
  'Public Client',
  'DCR Endpoint',
  'Status',
  'Details',
];

function cell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

export function rowFor(e: EndpointResult): string[] {
  const oauth = !!e.completedAt && e.classification.status === 'complete';
  const regEndpoint = e.as.metadata?.registration_endpoint;
  return [
    displayName(e),
    e.url,
    // The taxonomy value as it was in the CSV the endpoint came from (the "level:" prefix is dropped).
    e.category ? e.category.slice(e.category.indexOf(':') + 1) : '',
    oauth ? yesNo(dcrState(e) !== 'none') : 'N/A',
    oauth ? yesNo(isCimd(e)) : 'N/A',
    oauth ? yesNo(e.classification.hasPublicClients) : 'N/A',
    typeof regEndpoint === 'string' ? regEndpoint : '',
    statusOf(e).text,
    summarizeDetails(e),
  ];
}

export function buildCsv(run: RunState): string {
  const rows = run.endpoints.map((e) => rowFor(e).map(cell).join(','));
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n');
}
