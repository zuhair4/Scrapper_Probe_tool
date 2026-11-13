import { describe, it, expect } from 'vitest';
import { bodySnippet, summarizeDetails } from '../src/features/probe/lib/details';
import { buildCsv, CSV_COLUMNS, rowFor } from '../src/features/probe/lib/exportCsv';
import { discoverEndpoint } from '../src/features/probe/lib/discovery';
import { DEFAULT_SETTINGS } from '../src/features/probe/lib/probeTypes';
import type { Fetcher, ProbeResponse, RunState } from '../src/features/probe/lib/probeTypes';

const mk = (status: number, body?: unknown, headers: Record<string, string> = {}, extra: Partial<ProbeResponse> = {}): ProbeResponse => ({
  status,
  statusText: '',
  headers,
  bodyText: body === undefined ? '' : JSON.stringify(body),
  bodyJson: body ?? null,
  contentType: body === undefined ? '' : 'application/json',
  elapsedMs: 1,
  finalUrl: '',
  redirectHops: [],
  ...extra,
});

const url = 'https://mcp.example.com/mcp';

async function run(routes: Record<string, ProbeResponse>) {
  const fetcher: Fetcher = async (req) => routes[`${req.method} ${req.url}`] ?? mk(404);
  return discoverEndpoint(url, 'Example App', DEFAULT_SETTINGS, fetcher, () => {});
}

const oauthRoutes = {
  [`POST ${url}`]: mk(401, undefined, { 'www-authenticate': 'Bearer realm="x"' }),
  'GET https://mcp.example.com/.well-known/oauth-protected-resource/mcp': mk(200, {
    resource: url,
    authorization_servers: ['https://auth.example.com'],
  }),
  'GET https://auth.example.com/.well-known/oauth-authorization-server': mk(200, {
    issuer: 'https://auth.example.com',
    registration_endpoint: 'https://auth.example.com/register',
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
  }),
  'POST https://auth.example.com/register': mk(401, { error: 'invalid_token', error_description: 'registration needs a token' }),
};

describe('bodySnippet', () => {
  it('compacts JSON, strips HTML and truncates', () => {
    expect(bodySnippet(mk(200, { a: 1, b: [2] }))).toBe('{"a":1,"b":[2]}');
    const html = mk(403, undefined, {}, { bodyText: '<html><style>x{}</style><h1>Access   denied</h1></html>', contentType: 'text/html' });
    expect(bodySnippet(html)).toBe('Access denied');
    expect(bodySnippet(mk(200, { long: 'x'.repeat(500) }), 50).endsWith('…')).toBe(true);
  });
});

describe('CSV export', () => {
  it('has exactly the table columns, in order', () => {
    expect(CSV_COLUMNS).toEqual(['Name', 'MCP Endpoint', 'Category', 'DCR', 'CIMD', 'Public Client', 'DCR Endpoint', 'Status', 'Details']);
  });

  it('exports the category the endpoint was loaded with, as the raw taxonomy value, and blank without one', async () => {
    const e = await run(oauthRoutes);
    expect(rowFor(e)[2]).toBe('');
    expect(rowFor({ ...e, category: 'dept:design' })[2]).toBe('design');
    expect(rowFor({ ...e, category: 'object:files-documents' })[2]).toBe('files-documents');
  });

  it('exports a gated DCR endpoint with the response body in Details', async () => {
    const e = await run(oauthRoutes);
    const row = rowFor(e);
    expect(row.slice(0, 8)).toEqual([
      'Example App',
      url,
      '',
      'Yes',
      'Yes',
      'Yes',
      'https://auth.example.com/register',
      'Complete',
    ]);
    const details = row[8];
    expect(details).toContain('Challenge POST: HTTP 401');
    expect(details).toContain('WWW-Authenticate: Bearer realm="x"');
    expect(details).toContain('PRM: https://mcp.example.com/.well-known/oauth-protected-resource/mcp');
    expect(details).toContain('AS metadata: https://auth.example.com/.well-known/oauth-authorization-server (issuer https://auth.example.com)');
    expect(details).toContain('DCR probe: HTTP 401 (gated or rejected) - {"error":"invalid_token","error_description":"registration needs a token"}');
  });

  it('marks DCR/CIMD/public client N/A and explains why when not complete', async () => {
    const e = await run({ [`POST ${url}`]: mk(403, undefined, {}, { bodyText: '<h1>Access Denied</h1> cloudfront', contentType: 'text/html' }) });
    const row = rowFor(e);
    expect(row.slice(3, 8)).toEqual(['N/A', 'N/A', 'N/A', '', 'Not complete']);
    expect(row[8]).toContain('Result: CDN/WAF blocked the probe');
    expect(row[8]).toContain('Challenge POST: HTTP 403 - Access Denied cloudfront');
  });

  it('builds a quoted, CRLF-separated CSV with one data row per endpoint', async () => {
    const e = await run(oauthRoutes);
    const csv = buildCsv({ id: 'r', label: 'r', startedAt: 0, settings: DEFAULT_SETTINGS, status: 'complete', endpoints: [e, e] } as RunState);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines[1]).toContain('| DCR probe: HTTP 401 (gated or rejected) - {""error"":""invalid_token""');
    expect(summarizeDetails(e).length).toBeLessThan(1500);
  });
});
