// Parsing for the chatgpt.com plugin directory responses. The page gets home and detail through the
// app's own backend (backend/src/chatgpt/pluginStoreRouter.ts). The full category lists are read from a HAR captured in the
// user's own browser (frontend/src/features/chatgpt-scraper/capture-chatgpt-har.js), because chatgpt.com answers server-side requests
// for them with a Cloudflare challenge. The three /backend-api/ps endpoints:
//   /plugins/home                      -> { sections: [{ id, url_slug, title, description, plugins: [...] }] }
//                                         (confirmed; each section is a teaser of about 9 plugins)
//   /plugin-categories/<slug>/plugins?scope=GLOBAL&limit=100
//                                      -> full list of one category (paging and field names are read
//                                         tolerantly; the older chatgpt.com/plugins?category=<slug> page
//                                         shape { directory: { sections, next } } is read too)
//   /plugins/<id>                      -> { id, name, release: { display_name, version, description,
//                                         interface: { developer_name, website_url, ... } }, ... } (confirmed)

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);

// ---------- tolerant readers ----------

const getPath = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (isObj(v) ? v[k] : undefined), o);

/** A readable string from a value: strings as is, objects by their name/title, arrays joined. */
export function strOf(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(strOf).filter(Boolean).join('; ');
  if (isObj(v)) return strOf(v.name ?? v.display_name ?? v.title ?? v.label);
  return '';
}

/** First non-empty value among the candidate paths (dot paths allowed). */
export function pick(o: unknown, paths: string[]): string {
  for (const p of paths) {
    const s = strOf(getPath(o, p));
    if (s) return s;
  }
  return '';
}

/** The list an API response is about: the given keys (also nested), else the largest array of objects. */
export function findList(json: unknown, keys: string[], depth = 3): unknown[] {
  if (Array.isArray(json)) return json;
  if (!isObj(json)) return [];
  for (const k of keys) if (Array.isArray(json[k])) return json[k] as unknown[];
  if (depth > 0) {
    for (const v of Object.values(json)) {
      if (!isObj(v)) continue;
      const r = findList(v, keys, depth - 1);
      if (r.length) return r;
    }
  }
  let best: unknown[] = [];
  for (const v of Object.values(json)) if (Array.isArray(v) && v.some(isObj) && v.length > best.length) best = v;
  return best;
}

export const kebab = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---------- plugins ----------

/** One entry of release.mcp_servers: { key, metadata: { type, url, headers, extensions, command, args, env } }. */
export interface McpServer {
  key: string;
  /** Remote endpoint, metadata.url. Empty for local (stdio) servers. */
  url: string;
  /** metadata.type as stated (http, streamable-http, stdio, ...); empty when the directory does not say. */
  transport: string;
  /** One-line auth summary, e.g. "oauth · client: dcr · scopes: mcp:read". Empty when the directory says nothing. */
  auth: string;
  /** auth.type from metadata.extensions["com.openai"].auth: oauth, none or mixed. */
  authType: string;
  /** auth.client.mode: dcr, cimd or provided. */
  clientMode: string;
  /** auth.client.clientId, set when the client is provided (a public identifier). */
  clientId: string;
  tokenAuthMethod: string;
  /** baseScopes and defaultScopes, space separated. */
  scopes: string;
  /** resource / authorization server / registration / authorization / token URLs from the auth settings. */
  authUrls: string;
  /** extensions["com.openai"].urlTemplates: endpoint URLs with a placeholder such as {instance}. */
  urlTemplates: string;
  /** "command arg arg" for a local server started on the user's machine. */
  command: string;
  /** Names only; header and env values are never kept (they can be secrets). */
  headerNames: string;
  envNames: string;
  /** The raw entry as JSON, kept only when it has neither a url nor a command. */
  raw: string;
}

export type McpStatus = 'remote' | 'local-only' | 'unrecognised' | 'app-unpublished' | 'connector' | 'skills-only' | 'none' | 'not-fetched';

export const MCP_STATUS_LABEL: Record<McpStatus, string> = {
  remote: 'Remote endpoint listed',
  'local-only': 'Local command only (no URL)',
  unrecognised: 'Server listed, format not recognised',
  'app-unpublished': 'App: endpoint not published in directory',
  connector: 'Connector: no endpoint published',
  'skills-only': 'Skills only: no server',
  none: 'No server',
  'not-fetched': 'Details not fetched yet',
};
export const MCP_STATUS_ORDER = Object.keys(MCP_STATUS_LABEL) as McpStatus[];

export interface PsPlugin {
  id: string;
  name: string;
  /** Short description (the one-liner shown in the directory). */
  description: string;
  /** Full description, from the detail call. */
  longDescription: string;
  developer: string;
  /** Category title from the detail call, e.g. "Creativity". */
  categoryTitle: string;
  iconUrl: string;
  website: string;
  privacyPolicy: string;
  termsOfService: string;
  capabilities: string;
  /** Every server in release.mcp_servers (remote URLs, local commands, anything else), in order. */
  mcp: McpServer[];
  mcpStatus: McpStatus;
  /** URLs containing "mcp" mentioned in the description text but not listed as a server (may be docs). */
  mcpMentioned: string;
  /** release.app_ids, e.g. asdk_app_... or connector_... */
  appIds: string;
  appId: string;
  status: string;
  installationPolicy: string;
  authPolicy: string;
  discoverability: string;
  version: string;
  createdAt: string;
  keywords: string;
  plans: string;
  shareUrl: string;
  /** Category slugs it was listed under. */
  categories: string[];
  /** True once the detail call has been merged in. */
  hasDetail: boolean;
}

const TEXT_FIELDS = [
  'name', 'description', 'longDescription', 'developer', 'categoryTitle', 'iconUrl', 'website', 'privacyPolicy', 'termsOfService',
  'capabilities', 'mcpMentioned', 'appIds', 'appId', 'status', 'installationPolicy', 'authPolicy', 'discoverability', 'version', 'createdAt', 'keywords', 'plans', 'shareUrl',
] as const;

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()) : []);
const keyNames = (v: unknown): string => (isObj(v) ? Object.keys(v).join(', ') : '');

interface AuthInfo {
  auth: string;
  authType: string;
  clientMode: string;
  clientId: string;
  tokenAuthMethod: string;
  scopes: string;
  authUrls: string;
  urlTemplates: string;
}

/** The auth block of a server: metadata.extensions["com.openai"] (the key itself contains a dot). */
function authOf(m: Obj): AuthInfo {
  const ext = isObj(m.extensions) ? m.extensions : {};
  const oa = isObj(ext['com.openai']) ? ext['com.openai'] : {};
  const a = isObj(oa.auth) ? oa.auth : {};
  const authType = pick(a, ['type']);
  const clientMode = pick(a, ['client.mode']);
  const clientId = pick(a, ['client.clientId']);
  const tokenAuthMethod = pick(a, ['client.tokenEndpointAuthMethod']);
  const scopes = [...new Set([...strList(a.baseScopes), ...strList(a.defaultScopes), ...strList(a.scopes)])].join(' ');
  const other = Object.keys(ext).filter((k) => k !== 'com.openai');
  const auth = [authType, clientMode && `client: ${clientMode}`, scopes && `scopes: ${scopes}`, other.length && `other extensions: ${other.join(', ')}`].filter(Boolean).join(' · ');
  const urls: Array<[string, string]> = [
    ['resource', pick(a, ['resource']) || pick(m, ['oauth_resource'])],
    ['authorization server', pick(a, ['authorizationServerBase'])],
    ['registration', pick(a, ['registrationUrl'])],
    ['authorization', pick(a, ['authorizationUrl'])],
    ['token', pick(a, ['tokenUrl'])],
  ];
  return {
    auth,
    authType,
    clientMode,
    clientId,
    tokenAuthMethod,
    scopes,
    authUrls: urls.filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; '),
    urlTemplates: strList(oa.urlTemplates).join('; '),
  };
}

/** Reads release.mcp_servers without dropping anything: every entry becomes a McpServer. */
export function parseMcpServers(servers: unknown): McpServer[] {
  if (!Array.isArray(servers)) return [];
  return servers.map((s) => {
    const m: Obj = isObj(s) && isObj(s.metadata) ? s.metadata : isObj(s) ? s : {};
    const url = pick(m, ['url', 'endpoint', 'server_url']);
    const command = [pick(m, ['command']), ...strList(m.args)].filter(Boolean).join(' ');
    const au = authOf(m);
    return {
      key: pick(s, ['key', 'name', 'id']),
      url,
      transport: pick(m, ['type', 'transport']),
      ...au,
      command,
      headerNames: keyNames(m.headers),
      envNames: keyNames(m.env),
      raw: url || command ? '' : JSON.stringify(s),
    };
  });
}

/** Why a plugin has (or has not) an MCP endpoint, from the detail's release block. */
export function classifyMcp(release: unknown, servers: McpServer[]): McpStatus {
  if (servers.some((x) => x.url)) return 'remote';
  if (servers.some((x) => x.command)) return 'local-only';
  if (servers.length) return 'unrecognised';
  const appIds = strList(getPath(release, 'app_ids'));
  if (appIds.some((a) => a.startsWith('asdk_app_'))) return 'app-unpublished';
  if (appIds.length) return 'connector';
  const skills = getPath(release, 'skills');
  return Array.isArray(skills) && skills.length ? 'skills-only' : 'none';
}

/** MCP-looking URLs in the description text that are not listed servers (a docs page or an endpoint). */
export function mentionedMcpUrls(release: unknown, servers: McpServer[]): string {
  const text = [pick(release, ['description']), pick(release, ['interface.long_description']), strList(getPath(release, 'interface.default_prompts')).join(' ')].join(' ');
  const listed = new Set(servers.map((x) => x.url));
  const found = (text.match(/https?:\/\/[^\s"'<>)\]]+/gi) ?? []).map((u) => u.replace(/[.,;:!?]+$/, '')).filter((u) => /mcp/i.test(u) && !listed.has(u));
  return [...new Set(found)].join('; ');
}

export const PLUGIN_LIST_KEYS = ['plugins', 'items', 'results', 'data', 'connectors', 'apps'];

/** Turns one list item or detail response into a PsPlugin; null when it has neither id nor name. */
export function normalizePlugin(raw: unknown, category?: string): PsPlugin | null {
  if (!isObj(raw)) return null;
  const o: Obj = isObj(raw.plugin) ? { ...raw, ...raw.plugin } : raw;
  const id = pick(o, ['id', 'plugin_id', 'connector_id']);
  const name = pick(o, ['release.display_name', 'display_name', 'name', 'title']);
  if (!id && !name) return null;
  const release = getPath(o, 'release');
  const hasDetail = isObj(release);
  const mcp = hasDetail ? parseMcpServers(getPath(o, 'release.mcp_servers')) : [];
  return {
    id,
    name,
    description: pick(o, ['short_description', 'release.interface.short_description', 'description']),
    longDescription: pick(o, ['release.interface.long_description', 'release.description', 'long_description']),
    developer: pick(o, ['release.interface.developer_name', 'creator_name', 'developer_name', 'developer', 'publisher']),
    categoryTitle: pick(o, ['release.interface.category']),
    iconUrl: pick(o, ['icon_url', 'iconUrl', 'release.interface.logo_url', 'logo_url', 'release.interface.composer_icon_url']),
    website: pick(o, ['release.interface.website_url', 'website_url']),
    privacyPolicy: pick(o, ['release.interface.privacy_policy_url', 'privacy_policy_url']),
    termsOfService: pick(o, ['release.interface.terms_of_service_url', 'terms_of_service_url']),
    capabilities: pick(o, ['release.interface.capabilities', 'capabilities', 'tools']),
    mcp,
    mcpStatus: hasDetail ? classifyMcp(release, mcp) : 'not-fetched',
    mcpMentioned: hasDetail ? mentionedMcpUrls(release, mcp) : '',
    appIds: strList(getPath(o, 'release.app_ids')).join('; '),
    appId: pick(o, ['canonical_app_id']),
    status: pick(o, ['status']),
    installationPolicy: pick(o, ['installation_policy']),
    authPolicy: pick(o, ['authentication_policy']),
    discoverability: pick(o, ['discoverability']),
    version: pick(o, ['release.version']),
    createdAt: pick(o, ['created_at']),
    keywords: pick(o, ['keywords', 'release.keywords']),
    plans: pick(o, ['eligible_plan_types']),
    shareUrl: pick(o, ['share_url']),
    categories: category ? [category] : [],
    hasDetail,
  };
}

/** Adds p to the map (by id, else name), merging categories and filling empty fields. */
export function mergePlugin(into: Map<string, PsPlugin>, p: PsPlugin): void {
  const key = p.id || `name:${p.name}`;
  const have = into.get(key);
  if (!have) {
    into.set(key, p);
    return;
  }
  for (const c of p.categories) if (!have.categories.includes(c)) have.categories.push(c);
  for (const f of TEXT_FIELDS) if (!have[f]) have[f] = p[f];
  if (p.hasDetail) {
    have.mcp = p.mcp;
    have.mcpStatus = p.mcpStatus;
    have.mcpMentioned = p.mcpMentioned;
  }
  have.hasDetail = have.hasDetail || p.hasDetail;
}

/** Folds a detail response into the plugin of that id (adds it if unknown). */
export function applyDetail(into: Map<string, PsPlugin>, id: string, detail: unknown): void {
  const d = normalizePlugin(detail);
  if (!d) return;
  d.id = d.id || id;
  mergePlugin(into, d);
}

// ---------- home ----------

export interface PsCategory {
  slug: string;
  title: string;
  description: string;
  /** Plugins listed for it on the home page (a teaser, not the full list). */
  teaser: number;
}

/**
 * Categories and teaser plugins from the home response. The slug is url_slug (the section id can be
 * "developer tools"). Plugins are added to `into` tagged with the section's slug.
 */
export function ingestHome(into: Map<string, PsPlugin>, home: unknown): PsCategory[] {
  const out: PsCategory[] = [];
  for (const s of findList(home, ['sections'])) {
    if (!isObj(s)) continue;
    const title = pick(s, ['title', 'name']);
    const slug = pick(s, ['url_slug', 'slug', 'id']) || kebab(title);
    if (!slug || out.some((c) => c.slug === slug)) continue;
    let teaser = 0;
    for (const raw of Array.isArray(s.plugins) ? s.plugins : []) {
      const p = normalizePlugin(raw, slug);
      if (!p) continue;
      teaser++;
      mergePlugin(into, p);
    }
    out.push({ slug, title: title || slug, description: pick(s, ['description']), teaser });
  }
  return out;
}

// ---------- category paging ----------

const CURSOR_KEYS = ['next_cursor', 'nextCursor', 'next_page_token', 'nextPageToken', 'next', 'cursor', 'after', 'end_cursor'];

/**
 * The continuation value of a list response, or null when there is none. The paging field of the
 * category endpoint has not been confirmed, so several common names are checked, at the top level
 * and in a pagination-like object. An explicit has_more:false ends paging.
 */
export function nextCursor(json: unknown): string | null {
  if (!isObj(json)) return null;
  const scopes = [json, json.pagination, json.page_info, json.pageInfo, json.paging, json.meta].filter(isObj);
  for (const s of scopes) {
    if (s.has_more === false || s.hasMore === false || s.hasNextPage === false) return null;
    for (const k of CURSOR_KEYS) {
      const v = s[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return null;
}

export interface PageInfo {
  items: PsPlugin[];
  next: string | null;
}

/** The sections of a /plugins?category=<slug> style response: { directory: { sections: [...], next } }. */
function directorySections(json: unknown): Obj[] | null {
  const d = isObj(json) ? json.directory : undefined;
  return isObj(d) && Array.isArray(d.sections) ? d.sections.filter(isObj) : null;
}

/** Category slug of a directory section: its "more" link (?category=<slug>), else url_slug / id. */
function sectionSlug(s: Obj): string {
  const more = pick(s, ['more']);
  if (more) {
    try {
      const c = new URL(more, 'https://chatgpt.com').searchParams.get('category');
      if (c) return c;
    } catch {
      // fall through
    }
  }
  return pick(s, ['url_slug', 'slug', 'id']);
}

/** Reads one category page (either response shape) and adds its plugins to the map. */
export function ingestCategoryPage(into: Map<string, PsPlugin>, json: unknown, slug: string): PageInfo {
  const sections = directorySections(json);
  const raws = sections ? sections.flatMap((s) => (Array.isArray(s.plugins) ? s.plugins : [])) : findList(json, PLUGIN_LIST_KEYS);
  const items: PsPlugin[] = [];
  for (const raw of raws) {
    const p = normalizePlugin(raw, slug);
    if (!p) continue;
    items.push(p);
    mergePlugin(into, p);
  }
  const dirNext = sections && isObj((json as Obj).directory) ? ((json as Obj).directory as Obj).next : undefined;
  return { items, next: typeof dirNext === 'string' && dirNext.trim() ? dirNext.trim() : nextCursor(json) };
}

/** Category slug of a request URL: /plugin-categories/<slug>/plugins or /plugins?category=<slug>. */
export function categoryOfUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/plugin-categories\/([^/]+)\/plugins$/);
    if (m) return decodeURIComponent(m[1]);
    if (u.pathname === '/plugins') return u.searchParams.get('category');
  } catch {
    // not a URL
  }
  return null;
}

/** The response body of a HAR entry as text (HAR may store it base64-encoded). */
function harBody(entry: unknown): string {
  const c = getPath(entry, 'response.content');
  if (!isObj(c) || typeof c.text !== 'string') return '';
  if (c.encoding !== 'base64') return c.text;
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(c.text), (ch) => ch.charCodeAt(0)));
  } catch {
    return '';
  }
}

/**
 * Category responses inside a browser HAR export (DevTools, Network, "Save all as HAR with content").
 * Only successful responses to category requests are read; every other entry is ignored.
 */
export function ingestHar(into: Map<string, PsPlugin>, entries: unknown[], known: string[]): ImportResult {
  const slugs: string[] = [];
  let plugins = 0;
  let cats: PsCategory[] = [];
  const body = (e: unknown): unknown => {
    if (getPath(e, 'response.status') !== 200) return undefined;
    try {
      return JSON.parse(harBody(e));
    } catch {
      return undefined;
    }
  };
  // The home response (category titles and a teaser of each) comes first, so the category lists below match its slugs.
  const home = entries.find((e) => new URL(pick(e, ['request.url']) || 'http://x', 'http://x').pathname.endsWith('/plugins/home') && body(e) !== undefined);
  if (home) cats = ingestHome(into, body(home));
  const allKnown = [...known, ...cats.map((c) => c.slug)];
  for (const e of entries) {
    const raw = categoryOfUrl(pick(e, ['request.url']));
    const json = raw ? body(e) : undefined;
    if (!raw || json === undefined) continue;
    const slug = allKnown.includes(raw) ? raw : kebab(raw);
    const r = ingestCategoryPage(into, json, slug);
    plugins += r.items.length;
    if (r.items.length && !slugs.includes(slug)) slugs.push(slug);
  }
  return { slugs, plugins, next: null, cats };
}

export interface ImportResult {
  slugs: string[];
  plugins: number;
  /** Set when the file says there is another page. */
  next: string | null;
  /** The categories of a home response found in the file (a HAR from frontend/src/features/chatgpt-scraper/capture-chatgpt-har.js has one). */
  cats?: PsCategory[];
}

/**
 * A category response the user saved from their own browser. The category is the file name when it
 * matches a known category, else the section's own slug (directory shape), else the file name.
 */
export function ingestImported(into: Map<string, PsPlugin>, json: unknown, fileName: string, known: string[]): ImportResult {
  if (isObj(json) && isObj(json.log) && Array.isArray(json.log.entries)) return ingestHar(into, json.log.entries, known);
  const hint = kebab(fileName.replace(/\.[^.]*$/, ''));
  const slugs: string[] = [];
  let plugins = 0;
  let next: string | null = null;
  const sections = directorySections(json);
  const groups: Array<{ slug: string; body: unknown }> = [];
  if (sections && sections.length > 1 && !known.includes(hint)) {
    for (const s of sections) groups.push({ slug: sectionSlug(s) || hint, body: { directory: { sections: [s], next: (json as { directory: Obj }).directory.next } } });
  } else {
    const slug = known.includes(hint) ? hint : sections?.length === 1 ? sectionSlug(sections[0]) || hint : hint;
    groups.push({ slug, body: json });
  }
  for (const g of groups) {
    const r = ingestCategoryPage(into, g.body, g.slug);
    plugins += r.items.length;
    next = next ?? r.next;
    if (!slugs.includes(g.slug)) slugs.push(g.slug);
  }
  return { slugs, plugins, next };
}

export class PsHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'PsHttpError';
  }
}

// ---------- export ----------

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

const q = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return s.includes(',') || s.includes('"') || s.includes(CR) || s.includes(LF) ? '"' + s.split('"').join('""') + '"' : s;
};

export const PS_CSV_COLUMNS = [
  'Name', 'Developer', 'Categories', 'Short description', 'Long description', 'Status', 'Installation policy', 'Auth policy', 'Version', 'Plans',
  'Keywords', 'Website', 'Privacy policy', 'Terms of service', 'Capabilities',
  'MCP status', 'MCP endpoint URLs', 'MCP transport', 'MCP auth', 'MCP auth URLs', 'MCP local command', 'MCP URLs mentioned in description',
  'App IDs', 'Icon URL', 'App ID', 'ID',
];

const join = (xs: string[]) => xs.filter(Boolean).join('; ');
/** "stdio" for a local server whose type is not stated, "(not stated)" for a URL whose type is not. */
const transportOf = (x: McpServer) => x.transport || (x.url ? '(not stated)' : x.command ? 'stdio' : '');

/** The MCP columns of one plugin, one cell per column, several servers joined with "; ". */
export function mcpColumns(p: PsPlugin): string[] {
  const remote = p.mcp.filter((x) => x.url);
  return [
    MCP_STATUS_LABEL[p.mcpStatus],
    join(remote.map((x) => x.url)),
    join(remote.map(transportOf)),
    join(remote.map((x) => x.auth)),
    join(remote.map((x) => x.authUrls)),
    join(p.mcp.filter((x) => x.command).map((x) => x.command)),
    p.mcpMentioned,
  ];
}

export function buildPsCsv(plugins: PsPlugin[]): string {
  const rows = plugins.map((p) =>
    [
      p.name, p.developer, p.categories.join('; '), p.description, p.longDescription, p.status, p.installationPolicy, p.authPolicy, p.version, p.plans,
      p.keywords, p.website, p.privacyPolicy, p.termsOfService, p.capabilities,
      ...mcpColumns(p),
      p.appIds, p.iconUrl, p.appId, p.id,
    ].map(q).join(',')
  );
  return [PS_CSV_COLUMNS.map(q).join(','), ...rows].join(CR + LF);
}

export const MCP_ENDPOINT_CSV_COLUMNS = [
  'Plugin', 'Plugin ID', 'Developer', 'Categories', 'Endpoint URL', 'URL templates', 'Transport', 'Server key', 'Auth type', 'Client mode', 'Client ID', 'Token auth method',
  'Scopes', 'Auth URLs', 'Header names', 'Local command', 'Env names', 'Unrecognised entry',
];

/** One row per MCP server entry (remote, local or unrecognised), the list to hand to the OAuth probe. */
export function buildMcpEndpointsCsv(plugins: PsPlugin[]): string {
  const rows = plugins.flatMap((p) =>
    p.mcp.map((x) =>
      [p.name, p.id, p.developer, p.categories.join('; '), x.url, x.urlTemplates, transportOf(x), x.key, x.authType, x.clientMode, x.clientId, x.tokenAuthMethod, x.scopes, x.authUrls, x.headerNames, x.command, x.envNames, x.raw]
        .map(q)
        .join(',')
    )
  );
  return [MCP_ENDPOINT_CSV_COLUMNS.map(q).join(','), ...rows].join(CR + LF);
}

/** "url | name" lines for the OAuth probe: every remote MCP endpoint of the given plugins, each URL once. */
export function probeLinesOf(plugins: PsPlugin[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const p of plugins) {
    for (const x of p.mcp) {
      if (!/^https?:\/\//i.test(x.url) || seen.has(x.url)) continue;
      seen.add(x.url);
      const label = p.name.replace(/\|/g, '/').trim();
      lines.push(label ? `${x.url} | ${label}` : x.url);
    }
  }
  return lines;
}
