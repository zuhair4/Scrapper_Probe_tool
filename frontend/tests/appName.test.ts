import { describe, it, expect } from 'vitest';
import { deriveAppName, displayName, hostLabel, parseServerName, probeNames, probeTitle } from '../src/features/probe/lib/appName';
import { discoverEndpoint } from '../src/features/probe/lib/discovery';
import { DEFAULT_SETTINGS } from '../src/features/probe/lib/probeTypes';
import type { Fetcher, ProbeResponse } from '../src/features/probe/lib/probeTypes';

const res = (over: Partial<ProbeResponse>): ProbeResponse => ({
  status: 200,
  statusText: 'OK',
  headers: {},
  bodyText: '',
  bodyJson: null,
  contentType: '',
  elapsedMs: 1,
  finalUrl: '',
  redirectHops: [],
  ...over,
});

describe('parseServerName', () => {
  it('reads serverInfo from a JSON initialize result, preferring title', () => {
    const body = { jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'acme-mcp', title: 'Acme Tools' } } };
    expect(parseServerName(res({ bodyJson: body }))).toBe('Acme Tools');
    expect(parseServerName(res({ bodyJson: { result: { serverInfo: { name: 'acme-mcp' } } } }))).toBe('acme-mcp');
  });

  it('reads serverInfo from an SSE stream', () => {
    const text = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"DeepWiki"}}}\n\n';
    expect(parseServerName(res({ bodyText: text }))).toBe('DeepWiki');
  });

  it('ignores non-2xx responses and bodies without serverInfo', () => {
    expect(parseServerName(res({ status: 401, bodyJson: { result: { serverInfo: { name: 'x' } } } }))).toBeUndefined();
    expect(parseServerName(res({ bodyJson: { result: {} } }))).toBeUndefined();
  });
});

describe('hostLabel', () => {
  it.each([
    ['https://mcp.atlassian.com/v2/mcp', 'Atlassian'],
    ['https://www.denik.me/mcp', 'Denik'],
    ['https://scopeclerk.com/api/v1/mcp', 'Scopeclerk'],
    ['https://mcp-standards.wiastandards.com/mcp', 'Wiastandards'],
    ['https://api.example.co.uk/mcp', 'Example'],
    ['https://my-tool.vercel.app/mcp', 'My Tool'],
  ])('%s -> %s', (url, expected) => {
    expect(hostLabel(url)).toBe(expected);
  });
});

describe('deriveAppName', () => {
  const prm = (name?: string) => ({ found: true, resourceMismatch: false, data: { resource_name: name } });
  const url = 'https://mcp.atlassian.com/v2/mcp';

  it('prefers PRM resource_name, then serverInfo, then a specific realm, then the hostname', () => {
    expect(deriveAppName({ url, prm: prm('Atlassian Rovo'), serverName: 'srv' })).toEqual({
      name: 'Atlassian Rovo',
      source: 'PRM resource_name',
    });
    expect(deriveAppName({ url, prm: prm(), serverName: 'srv' })).toEqual({ name: 'srv', source: 'MCP serverInfo' });
    expect(deriveAppName({ url, wwwAuth: { scheme: 'Bearer', realm: 'Acme API', raw: '' } })).toEqual({
      name: 'Acme API',
      source: 'WWW-Authenticate realm',
    });
    expect(deriveAppName({ url, wwwAuth: { scheme: 'Bearer', realm: 'OAuth', raw: '' } })).toEqual({
      name: 'Atlassian',
      source: 'hostname',
    });
  });

  it('displayName lets a typed name win', () => {
    expect(displayName({ url, label: 'Mine', appName: 'Auto' })).toBe('Mine');
    expect(displayName({ url, appName: 'Auto' })).toBe('Auto');
    expect(displayName({ url })).toBe('Atlassian');
  });
});

describe('discoverEndpoint app name', () => {
  it('takes the name from the initialize response of an open server', async () => {
    const fetcher: Fetcher = async (req) =>
      req.method === 'POST' && req.url === 'https://x.example.com/mcp'
        ? res({ bodyJson: { result: { serverInfo: { name: 'Open Server' } } } })
        : res({ status: 404 });
    const r = await discoverEndpoint('https://x.example.com/mcp', undefined, DEFAULT_SETTINGS, fetcher, () => {});
    expect(r.appName).toBe('Open Server');
    expect(r.appNameSource).toBe('MCP serverInfo');
  });
});

describe('probe run title', () => {
  const eps = (names: string[]) => names.map((label) => ({ label, appName: undefined, url: `https://${label.replace(/\W/g, '').toLowerCase()}.example.com/mcp` }));

  it('counts the endpoints in the title, or names a single one', () => {
    expect(probeTitle(eps(['Google Drive', 'Gmail', 'Google Calendar', 'Sheets']))).toBe('OAuth probe: 4 MCP endpoints');
    expect(probeTitle(eps(['Google Drive']))).toBe('OAuth probe: Google Drive');
  });

  it('lists the first names in words, with the rest counted', () => {
    expect(probeNames(eps(['Google Drive', 'Gmail', 'Google Calendar', 'Sheets', 'Docs']))).toBe('Google Drive, Gmail, Google Calendar and 2 more');
    expect(probeNames(eps(['Google Drive', 'Gmail', 'Google Calendar']))).toBe('Google Drive, Gmail and Google Calendar');
    expect(probeNames(eps(['Google Drive', 'Gmail']))).toBe('Google Drive and Gmail');
    expect(probeNames(eps(['Google Drive']))).toBe('');
  });
});
