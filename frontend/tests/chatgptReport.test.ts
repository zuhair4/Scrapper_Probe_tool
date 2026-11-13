import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildChatGPTReportData, DAILY_DAYS, NOT_STATED, TOP_DEVELOPERS } from '../src/features/reports/buildChatGPTReportData';
import { fillTemplate, PLACEHOLDER } from '../src/features/reports/fillReportTemplate';
import { chatgptReportFileName } from '../src/features/reports/generateChatGPTReport';
import { MCP_STATUS_ORDER } from '../src/features/chatgpt-scraper/pluginStore';
import type { McpServer, PsPlugin } from '../src/features/chatgpt-scraper/pluginStore';

const server = (over: Partial<McpServer> = {}): McpServer => ({
  key: 'k', url: 'https://x.example.com/mcp', transport: 'streamable-http', auth: '', authType: 'oauth', clientMode: 'dcr', clientId: '', tokenAuthMethod: '',
  scopes: '', authUrls: '', urlTemplates: '', command: '', headerNames: '', envNames: '', raw: '', ...over,
});

const plugin = (over: Partial<PsPlugin> = {}): PsPlugin => ({
  id: String(Math.random()), name: 'Plug', description: '', longDescription: '', developer: 'Dev', categoryTitle: '', iconUrl: '', website: '', privacyPolicy: '',
  termsOfService: '', capabilities: '', mcp: [], mcpStatus: 'none', mcpMentioned: '', appIds: '', appId: '', status: '', installationPolicy: '', authPolicy: '',
  discoverability: '', version: '', createdAt: '', keywords: '', plans: '', shareUrl: '', categories: [], hasDetail: true, ...over,
});

const remote = (over: Partial<PsPlugin> = {}, s: Partial<McpServer> = {}) => plugin({ mcp: [server(s)], mcpStatus: 'remote', ...over });

const CATS = [
  { slug: 'creativity', title: 'Creativity' },
  { slug: 'dev', title: 'Developer Tools' },
];
const ASOF = new Date('2026-10-29T10:00:00Z');

describe('buildChatGPTReportData', () => {
  it('counts statuses, remote plugins, distinct URLs and local commands', () => {
    const d = buildChatGPTReportData(
      [
        remote({ name: 'A' }, { url: 'https://a.example.com/mcp' }),
        remote({ name: 'B' }, { url: 'https://a.example.com/mcp' }), // same URL as A
        plugin({ name: 'C', mcp: [server({ url: '', command: 'npx tool' })], mcpStatus: 'local-only' }),
        plugin({ name: 'D', mcpStatus: 'connector' }),
        plugin({ name: 'E', hasDetail: false, mcpStatus: 'not-fetched' }),
      ],
      CATS,
      ASOF
    );
    expect(d.total).toBe(5);
    expect(d.withDetail).toBe(4);
    expect(d.status.remote).toBe(2);
    expect(d.status['local-only']).toBe(1);
    expect(d.status.connector).toBe(1);
    expect(d.status['not-fetched']).toBe(1);
    expect(Object.keys(d.status)).toEqual(MCP_STATUS_ORDER);
    expect(d.remotePlugins).toBe(2);
    expect(d.remoteServers).toBe(2);
    expect(d.distinctUrls).toBe(1);
    expect(d.localServers).toBe(1);
    expect(d.asof).toBe('2026-10-29');
  });

  it('summarises auth, OAuth client mode and transport of remote endpoints, with "not stated" where the directory is silent', () => {
    const d = buildChatGPTReportData(
      [
        remote({}, { url: 'https://1.example.com', authType: 'oauth', clientMode: 'dcr', transport: 'streamable-http' }),
        remote({}, { url: 'https://2.example.com', authType: 'oauth', clientMode: '', transport: '' }),
        remote({}, { url: 'https://3.example.com', authType: 'none', clientMode: '', transport: 'sse' }),
        remote({}, { url: 'https://4.example.com', authType: '', clientMode: '', transport: 'sse' }),
        remote({}, { url: 'https://5.example.com', authType: 'mixed', clientMode: 'cimd', transport: 'sse' }),
      ],
      CATS,
      ASOF
    );
    expect(d.authType).toEqual({ oauth: 2, none: 1, [NOT_STATED]: 1, mixed: 1 });
    // Client mode is only counted for endpoints that use OAuth or mixed auth.
    expect(d.clientMode).toEqual({ dcr: 1, [NOT_STATED]: 1, cimd: 1 });
    expect(d.transport).toEqual({ 'streamable-http': 1, [NOT_STATED]: 1, sse: 3 });
  });

  it('counts a plugin once per category it is listed under, sorted by size, with titles', () => {
    const d = buildChatGPTReportData(
      [
        remote({ categories: ['creativity', 'dev'] }),
        plugin({ categories: ['dev'] }),
        plugin({ categories: ['dev'] }),
        plugin({ categories: ['unlisted-slug'] }), // not in the category list: falls back to the slug
      ],
      CATS,
      ASOF
    );
    expect(d.categories.map((c) => [c.title, c.total, c.remote])).toEqual([
      ['Developer Tools', 3, 1],
      ['Creativity', 1, 1],
      ['unlisted-slug', 1, 0],
    ]);
    expect(d.categories[0].status).toEqual({ remote: 1, none: 2 });
    expect(d.plugins.find((p) => p.c.length === 2)?.c).toEqual(['Creativity', 'Developer Tools']);
  });

  it('ranks developers, caps the list and ignores blank names', () => {
    const many = Array.from({ length: TOP_DEVELOPERS + 5 }, (_, i) => plugin({ developer: `Dev ${i}` }));
    const d = buildChatGPTReportData([remote({ developer: 'Big' }), remote({ developer: 'Big' }), plugin({ developer: 'Big' }), plugin({ developer: '  ' }), ...many], CATS, ASOF);
    expect(d.developers[0]).toEqual({ name: 'Big', plugins: 3, remote: 2 });
    expect(d.developers).toHaveLength(TOP_DEVELOPERS);
    expect(d.developerCount).toBe(TOP_DEVELOPERS + 5 + 1);
  });

  it('builds contiguous created-date months, fills gaps with zeros and counts undated plugins', () => {
    const d = buildChatGPTReportData(
      [
        plugin({ createdAt: '2026-05-26T19:35:11.518682Z' }),
        plugin({ createdAt: '2026-05-27T00:00:00Z' }),
        plugin({ createdAt: '2026-08-01T00:00:00Z' }),
        plugin({ createdAt: 'not a date' }),
        plugin({ createdAt: '' }),
      ],
      CATS,
      ASOF
    );
    expect(d.months).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(d.created).toEqual([2, 0, 0, 1, 0, 0]);
    expect(d.createdStatus.none).toEqual([2, 0, 0, 1, 0, 0]);
    expect(d.createdStatus.remote).toEqual([0, 0, 0, 0, 0, 0]);
    expect(d.daily).toHaveLength(DAILY_DAYS);
    expect(d.daily[DAILY_DAYS - 1][0]).toBe('2026-10-29');
    expect(d.dated).toBe(3);
    expect(d.undated).toBe(2);
  });

  it('counts plugins created per day over the last nine weeks, ending on the as-of day', () => {
    const d = buildChatGPTReportData(
      [
        plugin({ createdAt: '2026-10-29T08:00:00Z' }),
        plugin({ createdAt: '2026-10-29T20:00:00Z' }),
        plugin({ createdAt: '2026-10-28T00:00:00Z' }),
        plugin({ createdAt: '2025-01-01T00:00:00Z' }), // older than the window
      ],
      CATS,
      ASOF
    );
    expect(d.daily.slice(-2)).toEqual([['2026-10-28', 1], ['2026-10-29', 2]]);
    expect(d.daily.reduce((a, [, n]) => a + n, 0)).toBe(3);
  });

  it('has no months when no plugin has a created date', () => {
    const d = buildChatGPTReportData([plugin()], CATS, ASOF);
    expect(d.months).toEqual([]);
    expect(d.created).toEqual([]);
    expect(d.createdStatus.remote).toEqual([]);
  });

  it('keeps only http(s) websites and endpoint URLs in the table rows, and never header or env values', () => {
    const d = buildChatGPTReportData(
      [remote({ name: 'Z', website: 'javascript:alert(1)', mcp: [server({ headerNames: 'Authorization', envNames: 'SECRET_TOKEN' })] })],
      CATS,
      ASOF
    );
    expect(d.plugins[0].w).toBe('');
    expect(d.plugins[0].u).toEqual(['https://x.example.com/mcp']);
    const json = JSON.stringify(d);
    expect(json).not.toContain('SECRET_TOKEN');
    expect(json).not.toContain('Authorization');
  });

  it('builds an empty report, without throwing, for an empty scrape', () => {
    const d = buildChatGPTReportData([], [], ASOF);
    expect(d.total).toBe(0);
    expect(d.categories).toEqual([]);
    expect(d.plugins).toEqual([]);
    expect(d.remotePlugins).toBe(0);
  });

  it('flags duplicate plugin names', () => {
    const d = buildChatGPTReportData([plugin({ name: 'Same' }), plugin({ name: 'Same' }), plugin({ name: 'Other' })], CATS, ASOF);
    expect(d.dupnames).toBe(1);
  });
});

describe('the ChatGPT report page', () => {
  it('the shipped template has the placeholder once and the download button', () => {
    const t = readFileSync('frontend/src/features/reports/chatgptReportTemplate.html', 'utf8');
    expect(t.split(PLACEHOLDER)).toHaveLength(2);
    expect(t).toContain('id="dl"');
  });

  it('keeps hostile plugin names inert inside the inline script and fills the placeholder once', () => {
    const evil = '</script><script>alert(1)</script><!-- $& $1';
    const data = buildChatGPTReportData([remote({ name: evil, developer: evil })], CATS, ASOF);
    const html = fillTemplate(`<script>const D = ${PLACEHOLDER};</script>`, data);
    expect(html).not.toContain(PLACEHOLDER);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toContain('<!--');
  });

  it('names the file after the as-of date', () => {
    expect(chatgptReportFileName('2026-10-29')).toBe('chatgpt_plugins_dashboard_2026-10-29.html');
  });
});
