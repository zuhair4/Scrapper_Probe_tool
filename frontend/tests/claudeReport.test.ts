import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildReportData, DAILY_DAYS, MIN_MONTHS } from '../src/features/reports/buildClaudeReportData';
import { fillTemplate, PLACEHOLDER, safeJson } from '../src/features/reports/fillReportTemplate';

const mcp = { type: 'mcp_server', endpoint: { url: 'https://x.example.com/mcp' } };

// A connector (MCP-only, no source repository), so classify() == 'Connector'.
const conn = (over: Record<string, unknown> = {}) => ({
  id: String(Math.random()),
  name: 'Conn',
  verified_tier: 'community',
  added_time: '2026-10-05T00:00:00Z',
  components: [mcp],
  ...over,
});

const ASOF = new Date('2026-10-29T10:00:00Z');

describe('buildReportData', () => {
  it('counts connectors only and splits months and tiers', () => {
    const items = [
      conn({ added_time: '2026-08-10T00:00:00Z', verified_tier: 'partner' }),
      conn({ added_time: '2026-09-02T00:00:00Z' }),
      conn({ added_time: '2026-09-03T00:00:00Z' }),
      conn({ added_time: '2026-10-05T00:00:00Z', verified_tier: 'anthropic' }),
      conn({ added_time: null }), // undated
      { id: 'p', name: 'A plugin', components: [mcp, { type: 'skill' }], added_time: '2026-10-01T00:00:00Z' },
      { id: 'e', name: 'An extension', components: [{ type: 'desktop_extension' }], added_time: '2026-10-01T00:00:00Z' },
    ];
    const d = buildReportData(items, ASOF);
    expect(d.total).toBe(5);
    expect(d.dated).toBe(4);
    expect(d.undated).toBe(1);
    expect(d.asof).toBe('2026-10-29');
    expect(d.months.at(-1)).toBe('2026-10');
    expect(d.months).toContain('2026-09');
    const at = (m: string) => d.months.indexOf(m);
    expect(d.tot[at('2026-09')]).toBe(2);
    expect(d.tiers.partner[at('2026-08')]).toBe(1);
    expect(d.tiers.anthropic[at('2026-10')]).toBe(1);
    expect(d.tier_all).toEqual({ community: 3, partner: 1, anthropic: 1 });
  });

  it('is unaffected by plugins and extensions: the data is identical with or without them', () => {
    const connectors = [
      conn({ name: 'C1', added_time: '2026-09-02T00:00:00Z', taxonomy: { work_department: 'data' }, publisher: { name: 'PubC' } }),
      conn({ name: 'C2', added_time: '2026-10-03T00:00:00Z', verified_tier: 'partner', updated_time: '2026-10-04T00:00:00Z' }),
    ];
    const others = [
      // plugins: more than MCP, or MCP from a plugin repository
      { id: 'p1', name: 'PLUGIN-ONLY-NAME', publisher: { name: 'PLUGIN-PUB' }, verified_tier: 'anthropic', added_time: '2026-10-05T00:00:00Z',
        updated_time: '2026-10-06T00:00:00Z', taxonomy: { industry: 'PLUGIN-INDUSTRY' }, components: [mcp, { type: 'skill' }] },
      { id: 'p2', name: 'REPO-PLUGIN', verified_tier: 'partner', added_time: '2026-07-05T00:00:00Z',
        taxonomy: { work_department: 'sales' }, components: [mcp], source: { repository: { url: 'https://github.com/x/y' } } },
      // extensions
      { id: 'e1', name: 'EXTENSION-ONLY-NAME', publisher: { name: 'EXT-PUB' }, verified_tier: 'community', added_time: '2025-01-05T00:00:00Z',
        taxonomy: { life_area: 'EXT-LIFE' }, components: [{ type: 'desktop_extension' }] },
    ];
    const mixed = buildReportData([...others, ...connectors], ASOF);
    const only = buildReportData(connectors, ASOF);
    expect(mixed).toEqual(only);

    const json = JSON.stringify(mixed);
    for (const leak of ['PLUGIN-ONLY-NAME', 'PLUGIN-PUB', 'PLUGIN-INDUSTRY', 'REPO-PLUGIN', 'EXTENSION-ONLY-NAME', 'EXT-PUB', 'EXT-LIFE', '2025-01']) {
      expect(json).not.toContain(leak);
    }
    expect(mixed.total).toBe(2);
  });

  it('builds an empty report, without throwing, when a scrape has no connectors', () => {
    const d = buildReportData([{ id: 'p', name: 'P', components: [mcp, { type: 'skill' }], added_time: '2026-10-01T00:00:00Z' }], ASOF);
    expect(d.total).toBe(0);
    expect(d.cats).toEqual({});
  });

  it('pads to at least five contiguous months so the template never indexes before the start', () => {
    const d = buildReportData([conn({ added_time: '2026-10-05T00:00:00Z' })], ASOF);
    expect(d.months.length).toBeGreaterThanOrEqual(MIN_MONTHS);
    expect(d.months.at(-1)).toBe('2026-10');
    expect(d.tot).toHaveLength(d.months.length);
    const empty = buildReportData([], ASOF);
    expect(empty.months.length).toBe(MIN_MONTHS);
    expect(empty.total).toBe(0);
    expect(empty.daily).toHaveLength(DAILY_DAYS);
  });

  it('fills gap months with zeros', () => {
    const d = buildReportData(
      [conn({ added_time: '2026-01-10T00:00:00Z' }), conn({ added_time: '2026-06-10T00:00:00Z' })],
      new Date('2026-06-20T00:00:00Z')
    );
    expect(d.months).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
    expect(d.tot).toEqual([1, 0, 0, 0, 0, 1]);
  });

  it('returns a daily series of DAILY_DAYS days ending on the as-of day', () => {
    const d = buildReportData([conn({ added_time: '2026-10-28T08:00:00Z' }), conn({ added_time: '2026-10-28T09:00:00Z' })], ASOF);
    expect(d.daily).toHaveLength(DAILY_DAYS);
    expect(d.daily.at(-1)?.[0]).toBe('2026-10-29');
    expect(d.daily.at(-2)).toEqual(['2026-10-28', 2]);
  });

  it('labels each connector once: department, else industry, else life area. Object acted on alone leaves it uncategorized', () => {
    const d = buildReportData(
      [
        conn({ name: 'A', taxonomy: { work_department: 'marketing', industry: 'retail', object_acted_on: 'email' } }),
        conn({ name: 'B', taxonomy: { industry: 'retail', object_acted_on: ['email'] } }),
        conn({ name: 'C', taxonomy: { object_acted_on: ['email', 'files'] } }),
        conn({ name: 'D', taxonomy: { life_area: 'travel' } }),
        conn({ name: 'E' }), // untagged
      ],
      ASOF
    );
    expect(Object.keys(d.cats).sort()).toEqual(['dept:marketing', 'industry:retail', 'life:travel']);
    expect(d.counts).toMatchObject({ off: 3, dept: 1, ind: 1, life: 1, pred: 0 });
    expect(d.cats['dept:marketing'].pred).toEqual({});
    expect(d.total - d.counts.off).toBe(2); // C (object acted on only) and E (untagged)
  });

  it('records official counts per month, partner totals and the three latest names', () => {
    const tax = { work_department: 'data' };
    const d = buildReportData(
      [
        conn({ name: 'n1', taxonomy: tax, added_time: '2026-09-01T00:00:00Z', verified_tier: 'partner' }),
        conn({ name: 'n2', taxonomy: tax, added_time: '2026-09-02T00:00:00Z' }),
        conn({ name: 'n3', taxonomy: tax, added_time: '2026-10-03T00:00:00Z' }),
        conn({ name: 'n4', taxonomy: tax, added_time: '2026-10-04T00:00:00Z' }),
      ],
      ASOF
    );
    const c = d.cats['dept:data'];
    expect(c.total).toBe(4);
    expect(c.partner).toBe(1);
    expect(c.off).toEqual({ '2026-09': 2, '2026-10': 2 });
    expect(c.ex).toEqual(['n4', 'n3', 'n2']);
  });

  it('summarises updated vs added dates, publishers and duplicate names', () => {
    const d = buildReportData(
      [
        conn({ name: 'Same', publisher: { name: 'P1' }, added_time: '2026-10-01T00:00:00Z', updated_time: '2026-10-01T05:00:00Z' }),
        conn({ name: 'Same', publisher: { name: 'P1' }, added_time: '2026-09-01T00:00:00Z', updated_time: '2026-10-10T00:00:00Z' }),
        conn({ name: 'Other', publisher: { name: 'P2' } }),
      ],
      ASOF
    );
    expect(d.upd).toEqual({ n: 2, fresh: 1, later: 1, first: '2026-10-01', neg: 0 });
    expect(d.publishers).toBe(2);
    expect(d.dupnames).toBe(1);
  });
});

describe('embedding data in the page', () => {
  const evil = '</script><script>alert(1)</script><!-- $& $1 ' + String.fromCharCode(0x2028);

  it('escapes anything that could break out of an inline script, and round-trips', () => {
    const json = safeJson({ name: evil });
    expect(json).not.toContain('</script');
    expect(json).not.toContain('<!--');
    expect(json).not.toContain('<');
    expect(json).not.toContain(String.fromCharCode(0x2028));
    expect(JSON.parse(json)).toEqual({ name: evil });
  });

  it('fills the placeholder once, keeping data literal, and refuses a template without it', () => {
    // Names reach the data as category examples, so the connector needs a category.
    const data = buildReportData([conn({ name: evil, taxonomy: { work_department: 'data' } })], ASOF);
    expect(data.cats['dept:data'].ex[0]).toBe(evil);
    const html = fillTemplate(`<script>const D = ${PLACEHOLDER};</script>`, data);
    expect(html).not.toContain(PLACEHOLDER);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    // "$1" is left as text (not treated as a replace pattern); "&" is escaped on purpose.
    expect(html).toContain('$1');
    expect(html).toContain('$' + String.fromCharCode(92) + 'u0026');
    expect(() => fillTemplate('<html></html>', data)).toThrow(/placeholder/);
  });

  it('the shipped template has the placeholder, the download button and no model dependency', () => {
    const t = readFileSync('frontend/src/features/reports/claudeReportTemplate.html', 'utf8');
    expect(t.split(PLACEHOLDER)).toHaveLength(2);
    expect(t).toContain('id="dl"');
    expect(t).not.toContain('Official + estimated');
    expect(t).not.toContain('MD.n_train');
  });
});
