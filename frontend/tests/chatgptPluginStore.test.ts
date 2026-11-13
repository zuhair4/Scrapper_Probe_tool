import { describe, it, expect } from 'vitest';
import {
  MCP_ENDPOINT_CSV_COLUMNS,
  PS_CSV_COLUMNS,
  buildMcpEndpointsCsv,
  classifyMcp,
  mcpColumns,
  parseMcpServers,
  applyDetail,
  buildPsCsv,
  categoryOfUrl,
  ingestHome,
  ingestImported,
  nextCursor,
  normalizePlugin,
  probeLinesOf,
  type PsPlugin,
} from '../src/features/chatgpt-scraper/pluginStore';

// HOME and DETAIL are trimmed from real responses (ids and field names as returned; signed icon
// URLs shortened, long text cut). CATEGORY_PAGE is SYNTHETIC: the category response has not been
// seen, so it only exercises the tolerant list/paging reading.
const canva = {
  id: 'plugin_connector_68df33b1a2d081918778431a9cfca8ba',
  canonical_app_id: 'connector_68df33b1a2d081918778431a9cfca8ba',
  display_name: 'Canva',
  requires_local_executor: false,
  short_description: 'Create, review, edit designs',
  keywords: [],
  icon_url: 'https://files.openai.com/content?id=file_x',
  icon_url_dark: null,
  status: 'ENABLED',
  installation_policy: 'AVAILABLE',
  disabled_reason: null,
  eligible_plan_types: null,
};

const HOME = {
  sections: [
    {
      id: 'featured', url_slug: 'featured', title: 'Popular', description: 'A curated selection.',
      plugins: [
        { id: 'plugin_connector_1p_ab21a553bfbc81919ea8fd1858e3ffa7', canonical_app_id: 'connector_5f3c8c41a1e54ad7a76272c89e2554fa', display_name: 'TeamZ Drive', short_description: 'Drive, Docs, Sheets or Slides', keywords: ['teamz-drive', 'docs'], icon_url: 'https://files.openai.com/content?id=file_y', status: 'ENABLED', installation_policy: 'AVAILABLE', eligible_plan_types: ['plus', 'pro'] },
        canva,
      ],
    },
    { id: 'creativity', url_slug: 'creativity', title: 'Creativity', description: 'Create with writing, design.', plugins: [canva, { id: 'Plugin_fa77aec24fc08191bc6e57f377126d76', display_name: 'Product Design', short_description: 'Explore and prototype ideas', keywords: ['prototype'], status: 'ENABLED', installation_policy: 'AVAILABLE', eligible_plan_types: null }] },
    { id: 'business & operations', url_slug: 'business-and-operations', title: 'Business & Operations', description: 'Manage sales.', plugins: [] },
  ],
};

const DETAIL = {
  id: canva.id,
  name: 'canva',
  created_at: '2026-05-26T19:35:11.518682Z',
  scope: 'GLOBAL',
  canonical_app_id: canva.canonical_app_id,
  connector_id: canva.canonical_app_id,
  discoverability: 'LISTED',
  status: 'ENABLED',
  installation_policy: 'AVAILABLE',
  eligible_plan_types: null,
  authentication_policy: 'ON_INSTALL',
  release: {
    id: 'pluginrel_89224cb01f1c8191941dfd757a30beb0',
    version: '17.0.1',
    display_name: 'Canva',
    description: 'Bring your Canva design workflow into Codex.\n\nWhat Canva can do: ...',
    keywords: [],
    app_ids: [canva.canonical_app_id],
    interface: {
      short_description: 'Create, review, edit designs',
      long_description: 'Bring your Canva design workflow into Codex.\n\nWhat Canva can do: ...',
      developer_name: 'Canva Pty Ltd.',
      category: 'Creativity',
      plugin_category_id: 'creativity',
      capabilities: [],
      website_url: 'https://www.canva.com',
      privacy_policy_url: 'https://www.canva.com/policies/privacy-policy/',
      terms_of_service_url: 'https://www.canva.com/policies/terms-of-use/',
      logo_url: 'https://files.openai.com/content?id=file_z',
    },
    skills: [],
    mcp_servers: [],
  },
  creator_name: 'Canva Pty Ltd.',
  share_url: 'https://chatgpt.com/plugins/canva?open_in_app',
};

describe('home (real shape)', () => {
  it('reads sections as categories, slug from url_slug, and de-duplicates plugins across them', () => {
    const map = new Map<string, PsPlugin>();
    const cats = ingestHome(map, HOME);
    expect(cats.map((c) => [c.slug, c.title, c.teaser])).toEqual([
      ['featured', 'Popular', 2],
      ['creativity', 'Creativity', 2],
      ['business-and-operations', 'Business & Operations', 0],
    ]);
    expect(map.size).toBe(3);
    expect(map.get(canva.id)?.categories).toEqual(['featured', 'creativity']);
  });

  it('maps the list fields', () => {
    const map = new Map<string, PsPlugin>();
    ingestHome(map, HOME);
    expect(map.get('plugin_connector_1p_ab21a553bfbc81919ea8fd1858e3ffa7')).toMatchObject({
      name: 'TeamZ Drive',
      description: 'Drive, Docs, Sheets or Slides',
      appId: 'connector_5f3c8c41a1e54ad7a76272c89e2554fa',
      keywords: 'teamz-drive; docs',
      plans: 'plus; pro',
      status: 'ENABLED',
      installationPolicy: 'AVAILABLE',
      hasDetail: false,
    });
    // ids without canonical_app_id (Plugin_*) still work
    expect(map.get('Plugin_fa77aec24fc08191bc6e57f377126d76')).toMatchObject({ name: 'Product Design', appId: '' });
  });

  it('returns no categories for an unrecognised shape', () => {
    expect(ingestHome(new Map(), { hello: 'world' })).toEqual([]);
    expect(ingestHome(new Map(), null)).toEqual([]);
  });
});

describe('detail (real shape)', () => {
  it('reads release and release.interface, using release.display_name rather than the slug name', () => {
    const p = normalizePlugin(DETAIL) as PsPlugin;
    expect(p).toMatchObject({
      id: canva.id,
      name: 'Canva',
      developer: 'Canva Pty Ltd.',
      categoryTitle: 'Creativity',
      website: 'https://www.canva.com',
      privacyPolicy: 'https://www.canva.com/policies/privacy-policy/',
      termsOfService: 'https://www.canva.com/policies/terms-of-use/',
      version: '17.0.1',
      authPolicy: 'ON_INSTALL',
      discoverability: 'LISTED',
      createdAt: '2026-05-26T19:35:11.518682Z',
      shareUrl: 'https://chatgpt.com/plugins/canva?open_in_app',
      mcpStatus: 'connector',
      mcp: [],
      hasDetail: true,
    });
    expect(p.longDescription).toContain('What Canva can do');
  });

  it('merges into the home record without losing its categories', () => {
    const map = new Map<string, PsPlugin>();
    ingestHome(map, HOME);
    applyDetail(map, canva.id, DETAIL);
    expect(map.get(canva.id)).toMatchObject({ developer: 'Canva Pty Ltd.', hasDetail: true, categories: ['featured', 'creativity'], name: 'Canva', description: 'Create, review, edit designs' });
    expect(map.size).toBe(3);
  });
});

describe('nextCursor', () => {
  it('finds common continuation fields', () => {
    expect(nextCursor({ next_cursor: 'c1' })).toBe('c1');
    expect(nextCursor({ pagination: { nextCursor: 'c2' } })).toBe('c2');
  });
  it('ends on null, empty, has_more:false or no field', () => {
    expect(nextCursor({ next_cursor: null })).toBeNull();
    expect(nextCursor({ next_cursor: '' })).toBeNull();
    expect(nextCursor({ has_more: false, next_cursor: 'stale' })).toBeNull();
    expect(nextCursor({ plugins: [] })).toBeNull();
  });
});

describe('csv', () => {
  it('has one header per column and quotes commas, quotes and line breaks', () => {
    const p = normalizePlugin({ id: 'p', display_name: 'A, "B"', short_description: 'line1\nline2' }, 'c') as PsPlugin;
    const lines = buildPsCsv([p]).split('\r\n');
    expect(lines[0]).toBe(PS_CSV_COLUMNS.join(','));
    expect(buildPsCsv([p])).toContain('"A, ""B"""');
    expect(buildPsCsv([p])).toContain('"line1\nline2"');
  });
});

// Shape of GET /plugins?category=<slug> with accept: application/json ({ kind: "directory", ... }), as
// recorded earlier from a real response (fields trimmed). The site cannot fetch it (Cloudflare
// challenge), so it is read from a file the user saves from their own browser.
const DIRECTORY = {
  kind: 'directory',
  directory: {
    query: 'travel',
    sections: [
      {
        id: 'travel', title: 'Travel', more: '/plugins?category=travel',
        plugins: [
          { id: 'plugin_asdk_app_aaa', name: 'Expedia', description: 'Plan trips', iconUrl: 'https://x/i.png', detail: '/plugins/plugin_asdk_app_aaa', desktop: false },
          { id: 'plugin_connector_bbb', name: 'Booking', description: 'Book stays', detail: '/plugins/plugin_connector_bbb', desktop: true },
        ],
      },
    ],
    next: null,
  },
};

describe('directory-shaped category responses (saved from the browser)', () => {
  it('reads plugins from directory.sections[].plugins', () => {
    const map = new Map<string, PsPlugin>();
    const r = ingestImported(map, DIRECTORY, 'whatever.json', ['travel']);
    expect(r).toEqual({ slugs: ['travel'], plugins: 2, next: null });
    expect(map.get('plugin_asdk_app_aaa')).toMatchObject({ name: 'Expedia', description: 'Plan trips', iconUrl: 'https://x/i.png', categories: ['travel'] });
  });

  it('prefers a file name that matches a known category', () => {
    const map = new Map<string, PsPlugin>();
    expect(ingestImported(map, DIRECTORY, 'Business & Operations.json', ['business-and-operations']).slugs).toEqual(['business-and-operations']);
  });

  it('splits a multi-section file by each section’s own category link', () => {
    const two = { directory: { sections: [DIRECTORY.directory.sections[0], { id: 'finance', more: '/plugins?category=finance', plugins: [{ id: 'f1', name: 'Stripe' }] }], next: null } };
    const map = new Map<string, PsPlugin>();
    const r = ingestImported(map, two, 'home.json', ['travel', 'finance']);
    expect(r.slugs).toEqual(['travel', 'finance']);
    expect(map.get('f1')?.categories).toEqual(['finance']);
  });

  it('reports the continuation when the file says there is another page', () => {
    const map = new Map<string, PsPlugin>();
    const r = ingestImported(map, { directory: { sections: DIRECTORY.directory.sections, next: '/plugins?category=travel&after=abc' } }, 'travel.json', ['travel']);
    expect(r.next).toBe('/plugins?category=travel&after=abc');
  });

  it('still reads the /backend-api/ps list shape and tolerates garbage', () => {
    const map = new Map<string, PsPlugin>();
    expect(ingestImported(map, { plugins: [{ id: 'z', display_name: 'Z' }] }, 'travel.json', ['travel']).plugins).toBe(1);
    expect(ingestImported(map, { nothing: true }, 'travel.json', ['travel']).plugins).toBe(0);
  });
});

describe('HAR import (browser Network export)', () => {
  const entry = (url: string, body: unknown, status = 200, base64 = false) => ({
    request: { url },
    response: { status, content: base64 ? { text: Buffer.from(JSON.stringify(body)).toString('base64'), encoding: 'base64' } : { text: JSON.stringify(body) } },
  });

  it('recognises both category URL styles and nothing else', () => {
    expect(categoryOfUrl('https://chatgpt.com/backend-api/ps/plugin-categories/travel/plugins?scope=GLOBAL&limit=100')).toBe('travel');
    expect(categoryOfUrl('https://chatgpt.com/plugins?category=finance')).toBe('finance');
    expect(categoryOfUrl('https://chatgpt.com/backend-api/ps/plugins/home')).toBeNull();
    expect(categoryOfUrl('https://chatgpt.com/plugins')).toBeNull();
    expect(categoryOfUrl('not a url')).toBeNull();
  });

  it('pulls every category out of one HAR, plain or base64, skipping failures and other requests', () => {
    const har = {
      log: {
        entries: [
          entry('https://chatgpt.com/backend-api/ps/plugin-categories/travel/plugins?scope=GLOBAL&limit=100', { plugins: [{ id: 't1', display_name: 'Expedia' }] }),
          entry('https://chatgpt.com/plugins?category=finance', DIRECTORY, 200, true),
          entry('https://chatgpt.com/backend-api/ps/plugin-categories/security/plugins?limit=100', { plugins: [{ id: 's1', display_name: 'X' }] }, 403),
          entry('https://chatgpt.com/backend-api/ps/plugins/home', HOME),
          { request: { url: 'https://chatgpt.com/plugins?category=other' }, response: { status: 200, content: { text: '<html>' } } },
        ],
      },
    };
    const map = new Map<string, PsPlugin>();
    const r = ingestImported(map, har, 'chatgpt.com.har', ['travel', 'finance', 'security', 'other']);
    expect(r.slugs).toEqual(['travel', 'finance']);
    expect(r.plugins).toBe(3);
    expect(map.get('t1')?.categories).toEqual(['travel']);
    expect(map.get('plugin_asdk_app_aaa')?.categories).toEqual(['finance']);
    expect(map.has('s1')).toBe(false);
  });

  it('reads the home response in the file too: category titles, teasers, and paged category lists merged', () => {
    const home = { sections: [{ id: 'featured', url_slug: 'featured', title: 'Popular', description: '', plugins: [{ id: 'p1', display_name: 'One' }] }, { id: 'travel', url_slug: 'travel', title: 'Travel', plugins: [{ id: 't1', display_name: 'Trip' }] }] };
    const har = {
      log: {
        entries: [
          entry('https://chatgpt.com/backend-api/ps/plugin-categories/featured/plugins?scope=GLOBAL&limit=100', { plugins: [{ id: 'p1', display_name: 'One' }, { id: 'p2', display_name: 'Two' }] }),
          entry('https://chatgpt.com/backend-api/ps/plugins/home', home),
          entry('https://chatgpt.com/backend-api/ps/plugin-categories/featured/plugins?scope=GLOBAL&limit=100&cursor=abc', { plugins: [{ id: 'p3', display_name: 'Three' }] }),
          entry('https://chatgpt.com/backend-api/ps/plugin-categories/travel/plugins?scope=GLOBAL&limit=100', {}, 503),
        ],
      },
    };
    const map = new Map<string, PsPlugin>();
    const r = ingestImported(map, har, 'chatgpt-plugins-2026-10-30.har', []);
    expect(r.cats?.map((c) => [c.slug, c.title])).toEqual([['featured', 'Popular'], ['travel', 'Travel']]);
    expect(r.slugs).toEqual(['featured']);
    expect([...map.keys()].sort()).toEqual(['p1', 'p2', 'p3', 't1']);
    expect(map.get('p3')?.categories).toEqual(['featured']);
    expect(map.get('t1')?.categories).toEqual(['travel']);
  });
});

// ---- MCP endpoints. The entries below are copied from real detail responses (shortened), one per
// shape found when 780 real plugin details were read: a url with every field, a bare url, a url with
// OAuth settings, and two local servers started by a command.
const SERVER_FULL = { key: 'formatry-api', metadata: { type: 'streamable-http', url: 'https://formatry.cc/api/mcp', headers: {} } };
const SERVER_URL_ONLY = { key: 'mdedit', metadata: { url: 'https://mcp.mdedit.ai/mcp' } };
const SERVER_OAUTH = {
  key: 'lagrandecarte',
  metadata: { type: 'streamable-http', url: 'https://lagrandecarte.fr/mcp', headers: {}, extensions: { 'com.openai': { auth: { type: 'oauth', client: { mode: 'dcr' } } } } },
};
const SERVER_STDIO = { key: 'pen-dev', metadata: { type: 'stdio', command: './bin/pen-mcp', args: [], env: {} } };
const SERVER_UVX = {
  key: 'cad',
  metadata: { command: 'uvx', args: ['--no-config', '--from', 'cadgen==0.7.17', 'cadgen', 'mcp'], startup_timeout_sec: 300, env: { CADGEN_INSTALL_CHANNEL: 'openai-directory' } },
};
const detailWith = (release: Record<string, unknown>) => ({ ...DETAIL, release: { ...DETAIL.release, ...release } });
const plugin = (release: Record<string, unknown>) => normalizePlugin(detailWith(release)) as PsPlugin;

describe('MCP endpoints', () => {
  it('reads every server shape without dropping any', () => {
    const all = parseMcpServers([SERVER_FULL, SERVER_URL_ONLY, SERVER_OAUTH, SERVER_STDIO, SERVER_UVX]);
    expect(all).toHaveLength(5);
    expect(all.map((x) => x.url)).toEqual(['https://formatry.cc/api/mcp', 'https://mcp.mdedit.ai/mcp', 'https://lagrandecarte.fr/mcp', '', '']);
    expect(all.map((x) => x.transport)).toEqual(['streamable-http', '', 'streamable-http', 'stdio', '']);
    expect(all[2].auth).toBe('oauth · client: dcr');
    expect(all[3].command).toBe('./bin/pen-mcp');
    expect(all[4].command).toBe('uvx --no-config --from cadgen==0.7.17 cadgen mcp');
  });

  it('reads the OAuth urls, whose key contains a dot', () => {
    const [s] = parseMcpServers([
      {
        key: 'kipify',
        metadata: {
          url: 'https://api.kipify.io/mcp',
          extensions: { 'com.openai': { auth: { type: 'oauth', resource: 'https://api.kipify.io/mcp', registrationUrl: 'https://api.kipify.io/oauth/register', authorizationUrl: 'https://api.kipify.io/mcp/oauth/authorize', tokenUrl: 'https://api.kipify.io/mcp/oauth/token' } } },
        },
      },
    ]);
    expect(s.authUrls).toBe('resource=https://api.kipify.io/mcp; registration=https://api.kipify.io/oauth/register; authorization=https://api.kipify.io/mcp/oauth/authorize; token=https://api.kipify.io/mcp/oauth/token');
  });

  it('reads the auth details found in real entries: type, client mode, client id, scopes, auth server, templates', () => {
    const [a, b, c] = parseMcpServers([
      {
        key: 'prov',
        metadata: {
          url: 'https://api.example.com/mcp',
          extensions: { 'com.openai': { auth: { type: 'oauth', client: { mode: 'provided', clientId: 'oidc-chatgpt-example-v1', tokenEndpointAuthMethod: 'client_secret_basic' }, baseScopes: ['openid', 'email'], defaultScopes: ['mcp:read', 'openid'], authorizationServerBase: 'https://auth.example.com/' } } },
        },
      },
      { key: 'cimd', metadata: { url: 'https://c.example/mcp', extensions: { 'com.openai': { auth: { type: 'mixed', client: { mode: 'cimd' } } } } } },
      { key: 'tpl', metadata: { type: 'http', url: 'https://demo.analytics.example.com/api/mcp', oauth_resource: 'https://demo.analytics.example.com/api/mcp', extensions: { 'com.openai': { urlTemplates: ['https://{instance}.analytics.example.com/api/mcp'] } } } },
    ]);
    expect(a).toMatchObject({ authType: 'oauth', clientMode: 'provided', clientId: 'oidc-chatgpt-example-v1', tokenAuthMethod: 'client_secret_basic', scopes: 'openid email mcp:read' });
    expect(a.authUrls).toBe('authorization server=https://auth.example.com/');
    expect(a.auth).toBe('oauth · client: provided · scopes: openid email mcp:read');
    expect(b).toMatchObject({ authType: 'mixed', clientMode: 'cimd' });
    expect(c.urlTemplates).toBe('https://{instance}.analytics.example.com/api/mcp');
    expect(c.authUrls).toBe('resource=https://demo.analytics.example.com/api/mcp');
    expect(c.transport).toBe('http');
  });

  it('keeps header and env NAMES only, never their values', () => {
    const [s] = parseMcpServers([{ key: 'k', metadata: { url: 'https://x/mcp', headers: { Authorization: 'Bearer SECRET', 'X-Api-Key': 'SECRET2' }, env: { TOKEN: 'SECRET3' } } }]);
    expect(s.headerNames).toBe('Authorization, X-Api-Key');
    expect(s.envNames).toBe('TOKEN');
    expect(JSON.stringify(s)).not.toContain('SECRET');
  });

  it('keeps an entry it does not recognise, as raw JSON, instead of dropping it', () => {
    const [s] = parseMcpServers([{ key: 'odd', something: 'else' }]);
    expect(s.url).toBe('');
    expect(s.command).toBe('');
    expect(JSON.parse(s.raw)).toEqual({ key: 'odd', something: 'else' });
    expect(classifyMcp({ app_ids: [] }, [s])).toBe('unrecognised');
  });

  it('accepts a url that sits directly on the entry (no metadata block)', () => {
    expect(parseMcpServers([{ key: 'a', url: 'https://direct.example/mcp' }])[0].url).toBe('https://direct.example/mcp');
  });

  it('classifies why a plugin has no endpoint', () => {
    const app = { app_ids: ['asdk_app_6a5f75b10fe0819194a3431f9ebb086d'] };
    expect(classifyMcp({ ...app, mcp_servers: [SERVER_FULL] }, parseMcpServers([SERVER_FULL]))).toBe('remote');
    expect(classifyMcp(app, parseMcpServers([SERVER_STDIO]))).toBe('local-only');
    expect(classifyMcp(app, [])).toBe('app-unpublished');
    expect(classifyMcp({ app_ids: ['connector_openai_plugin_creator'] }, [])).toBe('connector');
    expect(classifyMcp({ skills: [{ name: 's' }] }, [])).toBe('skills-only');
    expect(classifyMcp({}, [])).toBe('none');
    // a remote url wins over a local command in the same plugin
    expect(classifyMcp(app, parseMcpServers([SERVER_UVX, SERVER_FULL]))).toBe('remote');
  });

  it('classifies whole plugins from a detail response, and "not fetched" from a list item', () => {
    expect(plugin({ mcp_servers: [SERVER_OAUTH] }).mcpStatus).toBe('remote');
    expect(plugin({ mcp_servers: [], app_ids: ['asdk_app_x'] }).mcpStatus).toBe('app-unpublished');
    const listItem = normalizePlugin({ id: 'plugin_asdk_app_x', display_name: 'X' }) as PsPlugin;
    expect(listItem).toMatchObject({ mcpStatus: 'not-fetched', mcp: [], hasDetail: false });
  });

  it('notes MCP urls mentioned only in the description, not those already listed', () => {
    const p = plugin({
      description: 'Docs at https://1to1mate.com/guide/mcp. Endpoint https://x.example/mcp is listed.',
      mcp_servers: [{ key: 'x', metadata: { url: 'https://x.example/mcp' } }],
    });
    expect(p.mcpMentioned).toBe('https://1to1mate.com/guide/mcp');
  });

  it('a detail response replaces the MCP fields of the home-list record', () => {
    const map = new Map<string, PsPlugin>();
    ingestHome(map, HOME);
    expect(map.get(canva.id)?.mcpStatus).toBe('not-fetched');
    applyDetail(map, canva.id, detailWith({ mcp_servers: [SERVER_FULL] }));
    expect(map.get(canva.id)).toMatchObject({ mcpStatus: 'remote', hasDetail: true });
    expect(map.get(canva.id)?.mcp[0].url).toBe('https://formatry.cc/api/mcp');
  });

  it('puts the MCP columns in the CSV, several servers joined, and local commands separate', () => {
    const p = plugin({ mcp_servers: [SERVER_FULL, SERVER_OAUTH, SERVER_UVX], app_ids: ['asdk_app_x'] });
    expect(mcpColumns(p)).toEqual([
      'Remote endpoint listed',
      'https://formatry.cc/api/mcp; https://lagrandecarte.fr/mcp',
      'streamable-http; streamable-http',
      'oauth · client: dcr',
      '',
      'uvx --no-config --from cadgen==0.7.17 cadgen mcp',
      '',
    ]);
    const header = buildPsCsv([p]).split('\r\n')[0].split(',');
    expect(header).toContain('MCP endpoint URLs');
    expect(header).toHaveLength(PS_CSV_COLUMNS.length);
  });

  it('builds "url | name" probe lines from remote endpoints only, each URL once', () => {
    const a = plugin({ mcp_servers: [SERVER_FULL, SERVER_UVX], app_ids: ['asdk_app_x'] });
    a.name = 'Format | Ry';
    const b = plugin({ mcp_servers: [SERVER_FULL, SERVER_OAUTH] });
    b.name = 'Other';
    const none = plugin({});
    expect(probeLinesOf([a, b, none])).toEqual(['https://formatry.cc/api/mcp | Format / Ry', 'https://lagrandecarte.fr/mcp | Other']);
    expect(probeLinesOf([none])).toEqual([]);
  });

  it('exports one row per server entry, including local and unrecognised ones', () => {
    const a = plugin({ mcp_servers: [SERVER_FULL, SERVER_STDIO] });
    const b = normalizePlugin({ id: 'z', display_name: 'No details' }) as PsPlugin;
    const lines = buildMcpEndpointsCsv([a, b]).split('\r\n');
    expect(lines[0]).toBe(MCP_ENDPOINT_CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('https://formatry.cc/api/mcp');
    expect(lines[2]).toContain('./bin/pen-mcp');
  });
});
