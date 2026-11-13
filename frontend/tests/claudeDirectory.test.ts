import { describe, it, expect } from 'vitest';
import {
  buildCSV,
  buildUnprobeableCSV,
  unprobeableItems,
  classify,
  getEndpoints,
  getRawType,
  lookupParams,
  primaryTaxonomy,
  probeLinesFor,
  probeSendFor,
  categoryForItem,
  taxValues,
} from '../src/features/claude-scraper/claudeDirectory';
import { endpointsFromCsv, guessColumns, readCsv } from '../src/features/probe/lib/probeCsv';

const mcp = { type: 'mcp_server', endpoint: { url: 'https://mcp.x.com/mcp' } };

describe('classify', () => {
  it('Extension when desktop_extension present', () => {
    expect(classify({ components: [{ type: 'desktop_extension' }, mcp] })).toBe('Extension');
  });
  it('Connector for MCP-only without a repository', () => {
    expect(classify({ components: [mcp] })).toBe('Connector');
  });
  it('Plugin for MCP-only from a repository', () => {
    expect(classify({ components: [mcp], source: { repository: { url: 'x' } } })).toBe('Plugin');
  });
  it('Plugin for mixed components and for missing components', () => {
    expect(classify({ components: [mcp, { type: 'skill' }] })).toBe('Plugin');
    expect(classify({})).toBe('Plugin');
  });
});

describe('helpers', () => {
  it('getRawType sorts and dedupes', () => {
    expect(getRawType({ components: [{ type: 'skill' }, mcp, { type: 'skill' }] })).toBe('mcp_server+skill');
    expect(getRawType({})).toBe('none');
  });

  it('getEndpoints handles all endpoint shapes and dedupes', () => {
    const item = {
      components: [
        { type: 'mcp_server', endpoint: { url: 'https://a.com' } },
        { type: 'mcp_server', endpoint: { url: 'https://a.com', options: [{ url: 'https://b.com' }] } },
        { type: 'mcp_server', endpoint: { hosts: ['h.com'], path_prefix: '/p' } },
        { type: 'mcp_server', endpoint: { regex: '^x$' } },
        { type: 'skill' },
      ],
    };
    expect(getEndpoints(item)).toEqual([
      'https://a.com',
      'https://b.com',
      'user-provided: https://h.com/p',
      'user-provided pattern: ^x$',
    ]);
  });

  it('taxonomy accepts string, array and null', () => {
    const item = { taxonomy: { industry: 'finance', subject: ['a', '', 'b'], work_department: null } };
    expect(taxValues(item, 'industry')).toEqual(['finance']);
    expect(taxValues(item, 'subject')).toEqual(['a', 'b']);
    expect(taxValues(item, 'work_department')).toEqual([]);
    expect(primaryTaxonomy(item)).toBe('finance');
    expect(primaryTaxonomy({})).toBeNull();
  });

  it('lookupParams escapes single quotes in the id', () => {
    expect(lookupParams("a'b").get('filter')).toBe("id == 'a\\'b'");
    expect(lookupParams('x').get('limit')).toBe('5');
  });
});

describe('probeLinesFor', () => {
  const server = (endpoint: object) => ({ type: 'mcp_server', endpoint });

  it('emits one "url | name" line per item, using its first http endpoint', () => {
    const items = [
      { name: 'A | B', components: [server({ url: 'https://a.com/mcp' })] },
      { name: 'Multi', components: [server({ url: 'https://m.com/1', options: [{ url: 'https://m.com/2' }] })] },
      { components: [server({ url: 'https://nolabel.com' })] },
    ];
    expect(probeLinesFor(items)).toEqual(['https://a.com/mcp | A / B', 'https://m.com/1 | Multi', 'https://nolabel.com']);
  });

  it('skips items with no fixed URL, so count = rows minus unprobeable rows', () => {
    const items = [
      { name: 'Ok', components: [server({ url: 'https://ok.com' })] },
      { title: 'Hosted', components: [server({ hosts: ['h.com'] })] },
      { name: 'Pattern', components: [server({ regex: '^x$' })] },
      { name: 'Plain', components: [{ type: 'skill' }] },
    ];
    expect(probeLinesFor(items)).toEqual(['https://ok.com | Ok']);
  });

  it('prefers the first http url even when a user-provided entry comes first', () => {
    const item = { name: 'Mixed', components: [server({ hosts: ['h.com'] }), server({ url: 'https://real.com' })] };
    expect(probeLinesFor([item])).toEqual(['https://real.com | Mixed']);
  });
});

describe('taxonomy category sent with Send to Probe', () => {
  const server = (endpoint: object) => ({ type: 'mcp_server', endpoint });
  const item = (name: string, url: string | null, taxonomy?: Record<string, unknown>) => ({
    id: name,
    name,
    taxonomy,
    components: [url ? server({ url }) : server({ hosts: ['h.com'] })],
  });

  it('is the primary taxonomy as "level:value": department, else industry, else object, else life area', () => {
    expect(categoryForItem(item('A', 'https://a.com', { work_department: 'design', industry: 'tech' }))).toBe('dept:design');
    expect(categoryForItem(item('B', 'https://b.com', { industry: 'retail-ecommerce', object_acted_on: 'files' }))).toBe('industry:retail-ecommerce');
    expect(categoryForItem(item('C', 'https://c.com', { object_acted_on: ['files-documents', 'notes-memory'] }))).toBe('object:files-documents');
    expect(categoryForItem(item('D', 'https://d.com', { life_area: 'work-career' }))).toBe('life:work-career');
    expect(categoryForItem(item('E', 'https://e.com', { subject: 'economics' }))).toBe('object:economics');
    expect(categoryForItem(item('F', 'https://f.com'))).toBeUndefined();
  });

  it('hands over the lines and a category for each URL that has one, leaving out items with no fixed URL', () => {
    const items = [
      item('A', 'https://a.com/mcp', { work_department: 'design' }),
      item('B', 'https://b.com/mcp'),
      item('Hosted', null, { industry: 'finance' }),
    ];
    expect(probeSendFor(items)).toEqual({
      lines: ['https://a.com/mcp | A', 'https://b.com/mcp | B'],
      categories: { 'https://a.com/mcp': 'dept:design' },
    });
  });

  it('is the same category the Probe’s CSV import reads from this page’s own CSV export', () => {
    const items = [
      item('A', 'https://a.com/mcp', { work_department: 'design', industry: 'tech' }),
      item('B', 'https://b.com/mcp', { industry: 'retail-ecommerce' }),
      item('C', 'https://c.com/mcp', { object_acted_on: ['files-documents', 'notes-memory'] }),
      item('D', 'https://d.com/mcp', { life_area: 'work-career' }),
      item('E', 'https://e.com/mcp', { subject: 'economics' }),
      item('F', 'https://f.com/mcp'),
    ];
    const table = readCsv(buildCSV(items))!;
    const imported = endpointsFromCsv(table, guessColumns(table.headers));
    expect(Object.fromEntries(imported.endpoints.map((e) => [e.url, e.category]))).toEqual(
      Object.fromEntries(items.map((i) => [(i.components[0].endpoint as { url: string }).url, categoryForItem(i)]))
    );
  });
});

describe('unprobeable connectors CSV', () => {
  const server = (endpoint: object) => ({ type: 'mcp_server', endpoint });
  const items = [
    { id: 'a', name: 'Fixed', components: [server({ url: 'https://ok.com' })] },
    {
      id: 'b',
      name: 'Hosted, Inc',
      publisher: { name: 'Acme' },
      verified_tier: 'partner',
      summary: 'Says "hi"',
      taxonomy: { industry: 'finance' },
      components: [server({ hosts: ['*.acme.com'], path_prefix: '/mcp', documentation: 'https://docs.acme.com' })],
    },
    { id: 'c', name: 'Pattern', components: [server({ regex: '^https://x$' })] },
    { id: 'd', name: 'Bare', components: [{ type: 'mcp_server' }] },
  ];

  it('selects exactly the items Send to Probe leaves out', () => {
    expect(unprobeableItems(items).map((i) => i.id)).toEqual(['b', 'c', 'd']);
    expect(probeLinesFor(items)).toHaveLength(items.length - unprobeableItems(items).length);
  });

  it('exports name, reason, hosts/pattern, docs and details with proper quoting', () => {
    const lines = buildUnprobeableCSV(unprobeableItems(items)).split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0].startsWith('Name,Publisher,Tier,Why not probeable')).toBe(true);
    expect(lines[0]).not.toContain('Description');
    expect(lines[1]).toContain('"Hosted, Inc",Acme,partner,Host list (user-provided),*.acme.com,,/mcp,https://docs.acme.com,"Says ""hi""",finance');
    expect(lines[2]).toContain('Pattern,,,URL pattern (regex),,^https://x$');
    expect(lines[3]).toContain('Bare,,,No endpoint details in directory');
  });
});

describe('buildCSV', () => {
  it('emits 20 quoted columns and escapes quotes', () => {
    const csv = buildCSV([
      {
        id: 'plugin_1',
        name: 'Say "hi"',
        components: [mcp],
        publisher: { name: 'Acme' },
        links: { documentation: 'https://docs' },
        added_time: '2025-01-01T00:00:00Z',
        updated_time: null,
      },
    ]);
    const [header, row] = csv.split('\n');
    expect(header.split('","')).toHaveLength(20);
    expect(row).toContain('"Say ""hi"""');
    expect(row).toContain('"Connector"');
    expect(row).toContain('"https://mcp.x.com/mcp"');
    expect(row.endsWith('"2025-01-01T00:00:00Z",""')).toBe(true);
  });
});
