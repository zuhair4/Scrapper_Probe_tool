import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyEndpoint } from '../src/features/probe/lib/classify';
import { buildProbeReportData, normalizeUrl } from '../src/features/reports/buildProbeReportData';
import { fillTemplate, PLACEHOLDER } from '../src/features/reports/fillReportTemplate';
import type { ASMetadata, DCRProbeResult, EndpointResult } from '../src/features/probe/lib/probeTypes';

function ep(
  url: string,
  opts: { metadata?: ASMetadata; dcrStatus?: number; blocked?: boolean; www?: boolean; label?: string; status?: number } = {}
): EndpointResult {
  const prm = { found: !!opts.metadata, resourceMismatch: false };
  const as = opts.metadata ? { found: true, metadata: opts.metadata, issuerMismatch: false } : { found: false, issuerMismatch: false };
  const www = opts.www ? { scheme: 'Bearer', raw: 'Bearer' } : undefined;
  const classification = classifyEndpoint(prm, as, www, false, !!opts.blocked, url);
  const dcrResults = (opts.dcrStatus === undefined ? [] : [{ variant: 'A', status: opts.dcrStatus }]) as unknown as DCRProbeResult[];
  const attempts = opts.status ? ([{ response: { status: opts.status } }] as unknown as EndpointResult['attempts']) : [];
  return { id: url, label: opts.label, url, startedAt: 1, completedAt: 2, attempts, wwwAuthenticate: www, prm, as, classification, dcrResults };
}

const dcrMeta: ASMetadata = {
  issuer: 'i',
  registration_endpoint: 'https://a/register',
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
};
const cimdMeta: ASMetadata = { issuer: 'i', client_id_metadata_document_supported: true, code_challenge_methods_supported: ['S256'] };

const mcp = (url: string) => ({ type: 'mcp_server', endpoint: { url } });
const conn = (name: string, url: string, over: Record<string, unknown> = {}) => ({
  id: name,
  name,
  verified_tier: 'partner',
  added_time: '2026-03-04T00:00:00Z',
  components: [mcp(url)],
  ...over,
});
const RUN = new Date('2026-10-29T10:00:00Z');

describe('buildProbeReportData', () => {
  it('maps probe results to the dashboard row fields', () => {
    const d = buildProbeReportData(
      [
        ep('https://a.example/mcp', { metadata: dcrMeta, dcrStatus: 201, www: true, status: 401 }),
        ep('https://b.example/mcp', { metadata: cimdMeta, www: true, status: 401 }),
        ep('https://c.example/mcp', { status: 200 }), // no OAuth at all
        ep('https://d.example/mcp', { blocked: true, status: 403 }),
      ],
      null,
      RUN
    );
    const [a, b, c, dd] = d.rows;
    expect(a).toMatchObject({ dcr: 'Yes', cimd: 'No', status: 'Complete', reason: null, http: '401', prm: true, auth: 'Bearer', dprobe: 'open' });
    expect(b).toMatchObject({ dcr: 'No', cimd: 'Yes', dprobe: null });
    expect(c).toMatchObject({ dcr: null, cimd: null, status: 'Not complete', http: '200', reason: 'No OAuth metadata or WWW-Authenticate found' });
    expect(dd.reason).toMatch(/CDN\/WAF/);
    expect(d.run).toBe('Oct 29, 2026');
    expect(d.asof).toBe('2026-10-29');
  });

  it('flags a gated DCR endpoint as gated', () => {
    const d = buildProbeReportData([ep('https://a.example/mcp', { metadata: dcrMeta, dcrStatus: 401, www: true })], null, RUN);
    expect(d.rows[0]).toMatchObject({ dcr: 'Yes', dprobe: 'gated' });
  });

  it('has no directory fields or totals without a directory', () => {
    const d = buildProbeReportData([ep('https://a.example/mcp', { metadata: dcrMeta, www: true })], null, RUN);
    expect(d.dir).toBeNull();
    expect(d.rows[0]).toMatchObject({ tier: null, added: null, cat: null, catSrc: null });
    expect(d.join).toEqual({ endpoint: 0, name: 0, none: 0 });
  });

  it('joins to connectors by endpoint URL first, then by name, and counts the rest as unmatched', () => {
    const directory = [
      conn('Alpha', 'https://a.example/mcp', { taxonomy: { work_department: 'sales' }, verified_tier: 'partner', added_time: '2026-03-04T00:00:00Z' }),
      conn('Beta', 'https://beta.example/mcp', { taxonomy: { industry: 'retail' }, verified_tier: 'community', added_time: '2026-05-09T00:00:00Z' }),
    ];
    const d = buildProbeReportData(
      [
        ep('https://A.example/mcp/', { metadata: dcrMeta, www: true }), // same URL, different case and trailing slash
        ep('https://other.example/x', { metadata: dcrMeta, www: true, label: 'beta' }), // matched by name
        ep('https://nobody.example/mcp', { metadata: dcrMeta, www: true }), // unmatched
      ],
      directory,
      RUN
    );
    expect(d.join).toEqual({ endpoint: 1, name: 1, none: 1 });
    expect(d.rows[0]).toMatchObject({ name: 'Alpha', tier: 'partner', added: '2026-03', cat: 'dept:sales', catSrc: 'off' });
    expect(d.rows[1]).toMatchObject({ name: 'Beta', tier: 'community', added: '2026-05', cat: 'industry:retail' });
    expect(d.rows[2]).toMatchObject({ tier: null, added: null, cat: null });
    expect(d.dir).toEqual({ total: 2, partner: 1 });
  });

  it('never takes a tier or category from a plugin or an extension', () => {
    const directory = [
      conn('Alpha', 'https://a.example/mcp'),
      // a plugin that exposes the probed URL, and an extension
      { id: 'p', name: 'PLUGIN', verified_tier: 'anthropic', taxonomy: { industry: 'PLUGIN-CAT' }, components: [mcp('https://p.example/mcp'), { type: 'skill' }] },
      { id: 'e', name: 'EXT', verified_tier: 'community', components: [{ type: 'desktop_extension' }, mcp('https://e.example/mcp')] },
    ];
    const d = buildProbeReportData(
      [ep('https://p.example/mcp', { metadata: dcrMeta, www: true }), ep('https://e.example/mcp', { metadata: dcrMeta, www: true })],
      directory,
      RUN
    );
    expect(d.join.none).toBe(2);
    expect(d.dir).toEqual({ total: 1, partner: 1 });
    expect(JSON.stringify(d)).not.toContain('PLUGIN-CAT');
    expect(d.rows.every((r) => r.tier === null && r.cat === null)).toBe(true);
  });

  it('files a matched but untagged connector without a category', () => {
    const d = buildProbeReportData([ep('https://a.example/mcp', { metadata: dcrMeta, www: true })], [conn('Alpha', 'https://a.example/mcp')], RUN);
    expect(d.rows[0]).toMatchObject({ tier: 'partner', cat: null, catSrc: null });
  });

  it('uses the category an endpoint was loaded with, even with no directory', () => {
    const d = buildProbeReportData(
      [{ ...ep('https://a.example/mcp', { metadata: dcrMeta, www: true }), category: 'dept:design' }, ep('https://b.example/mcp', { metadata: dcrMeta, www: true })],
      null,
      RUN
    );
    expect(d.dir).toBeNull();
    expect(d.rows[0]).toMatchObject({ cat: 'dept:design', catSrc: 'off', tier: null });
    expect(d.rows[1]).toMatchObject({ cat: null, catSrc: null });
  });

  it('keeps the loaded category when the matched connector has none, and lets the directory’s own category win otherwise', () => {
    const directory = [conn('Alpha', 'https://a.example/mcp'), conn('Beta', 'https://b.example/mcp', { taxonomy: { industry: 'retail' } })];
    const d = buildProbeReportData(
      [
        { ...ep('https://a.example/mcp', { metadata: dcrMeta, www: true }), category: 'dept:design' },
        { ...ep('https://b.example/mcp', { metadata: dcrMeta, www: true }), category: 'dept:design' },
      ],
      directory,
      RUN
    );
    expect(d.rows[0]).toMatchObject({ tier: 'partner', cat: 'dept:design', catSrc: 'off' });
    expect(d.rows[1]).toMatchObject({ cat: 'industry:retail', catSrc: 'off' });
  });
});

describe('normalizeUrl', () => {
  it('ignores host case, trailing slash and fragment but keeps path and query', () => {
    expect(normalizeUrl('https://A.example/mcp/#x')).toBe('https://a.example/mcp');
    expect(normalizeUrl('https://a.example/mcp?k=1')).not.toBe(normalizeUrl('https://a.example/mcp'));
  });
});

describe('probe template', () => {
  const t = readFileSync('frontend/src/features/reports/probeReportTemplate.html', 'utf8');

  it('has the placeholder once and the download button', () => {
    expect(t.split(PLACEHOLDER)).toHaveLength(2);
    expect(t).toContain('id="dl"');
  });

  it('embeds data safely, including hostile endpoint names', () => {
    const evil = '</script><img src=x onerror=alert(1)>';
    const d = buildProbeReportData([ep('https://a.example/mcp', { metadata: dcrMeta, www: true, label: evil })], null, RUN);
    const html = fillTemplate(t, d);
    expect(html).not.toContain(PLACEHOLDER);
    expect(html.match(/<\/script>/g)).toHaveLength(t.match(/<\/script>/g)!.length);
    expect(html).not.toContain(evil);
  });
});
