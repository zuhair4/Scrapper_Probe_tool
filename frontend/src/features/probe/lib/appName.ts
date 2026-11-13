import type { EndpointResult, ParsedWWWAuthenticate, PRMResult, ProbeResponse } from './probeTypes';

export type NameSource = 'PRM resource_name' | 'MCP serverInfo' | 'WWW-Authenticate realm' | 'hostname';

function clean(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s.length > 0 && s.length <= 80 ? s : undefined;
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// The `initialize` result can come back as plain JSON or as an SSE stream ("data: {...}").
export function parseServerName(res: ProbeResponse): string | undefined {
  if (res.status < 200 || res.status >= 300) return undefined;

  let payloads: unknown[] = [];
  if (res.bodyJson != null) {
    payloads = Array.isArray(res.bodyJson) ? res.bodyJson : [res.bodyJson];
  } else {
    for (const line of (res.bodyText ?? '').split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const parsed = tryParse(line.slice(5).trim());
      if (parsed != null) payloads.push(parsed);
    }
  }

  for (const p of payloads) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const info = (p as any)?.result?.serverInfo;
    const name = clean(info?.title) ?? clean(info?.name);
    if (name) return name;
  }
  return undefined;
}

// Hosts where the registrable domain says nothing about the app: use the subdomain instead.
const SHARED_HOSTS = new Set([
  'vercel.app', 'netlify.app', 'herokuapp.com', 'workers.dev', 'pages.dev', 'github.io',
  'azurewebsites.net', 'run.app', 'fly.dev', 'onrender.com', 'amazonaws.com', 'railway.app',
  'ngrok.io', 'ngrok-free.app', 'deno.dev', 'web.app', 'firebaseapp.com', 'supabase.co',
]);
const GENERIC_LABELS = new Set(['www', 'mcp', 'api', 'app', 'apps', 'server', 'mcp-server', 'gateway', 'remote']);
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);

function titleCase(s: string): string {
  return s
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function hostLabel(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 1) return titleCase(host);

  const lastTwo = parts.slice(-2).join('.');
  if (SHARED_HOSTS.has(lastTwo) || SHARED_HOSTS.has(parts.slice(-3).join('.'))) {
    const sub = parts.find((p) => !GENERIC_LABELS.has(p)) ?? parts[0];
    return titleCase(sub);
  }

  // Drop the TLD (and a co./com. style second level), keep the registrable name.
  let end = parts.length - 1;
  if (parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2])) end--;
  const name = parts[end - 1] ?? parts[0];
  return titleCase(GENERIC_LABELS.has(name) && end >= 2 ? parts[end - 2] : name);
}

const GENERIC_REALMS = /^(oauth|oauth2|mcp|bearer|api|protected|mcp server|server|default|restricted|auth|authentication)$/i;

export function deriveAppName(input: {
  serverName?: string;
  prm?: PRMResult;
  wwwAuth?: ParsedWWWAuthenticate;
  url: string;
}): { name: string; source: NameSource } {
  const resourceName = clean(input.prm?.data?.resource_name);
  if (resourceName) return { name: resourceName, source: 'PRM resource_name' };

  const server = clean(input.serverName);
  if (server) return { name: server, source: 'MCP serverInfo' };

  const realm = clean(input.wwwAuth?.realm);
  if (realm && !GENERIC_REALMS.test(realm) && !/^https?:\/\//i.test(realm)) {
    return { name: realm, source: 'WWW-Authenticate realm' };
  }

  return { name: hostLabel(input.url), source: 'hostname' };
}

// What the table shows: a name the user typed wins, then the discovered name.
export function displayName(e: Pick<EndpointResult, 'label' | 'appName' | 'url'>): string {
  return e.label || e.appName || hostLabel(e.url);
}

type Named = Pick<EndpointResult, 'label' | 'appName' | 'url'>;

/** The title of a probe run: "OAuth probe: 24 MCP endpoints", or "OAuth probe: Google Drive" for a single endpoint. */
export function probeTitle(endpoints: Named[]): string {
  return endpoints.length === 1 ? `OAuth probe: ${displayName(endpoints[0])}` : `OAuth probe: ${endpoints.length} MCP endpoints`;
}

/** The first few names, in words: "Google Drive, Gmail, Google Calendar and 21 more". Empty for a single endpoint, whose name is in the title. */
export function probeNames(endpoints: Named[], shown = 3): string {
  if (endpoints.length < 2) return '';
  const names = endpoints.slice(0, shown).map(displayName);
  const rest = endpoints.length - names.length;
  if (rest > 0) return `${names.join(', ')} and ${rest} more`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
