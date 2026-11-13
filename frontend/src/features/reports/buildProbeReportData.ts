import { classify, getEndpoints } from '../claude-scraper/claudeDirectory';
import type { Item } from '../claude-scraper/claudeDirectory';
import { categoryOf } from './buildClaudeReportData';
import { dcrState, isCimd } from '../probe/lib/summary';
import { displayName } from '../probe/lib/appName';
import type { EndpointResult } from '../probe/lib/probeTypes';

// Builds the data object the probe dashboard renders (its `const D = {...}`) from a probe run.
// The directory is optional: with it, each endpoint is joined to a connector (by MCP URL, then by
// name) for tier, launch month and category; without it the dashboard leaves those views out.
// Only connectors are joined, so a plugin or extension never lends its tier or category.
// An endpoint loaded from a CSV carries its own category, so categories show without a directory.

export type YesNo = 'Yes' | 'No' | null;

export interface ProbeRow {
  name: string;
  url: string;
  dcr: YesNo;
  cimd: YesNo;
  status: 'Complete' | 'Not complete';
  reason: string | null;
  http: string | null;
  prm: boolean;
  auth: 'Bearer' | 'Key' | null;
  prov: string | null;
  dprobe: 'open' | 'gated' | null;
  tier: string | null;
  added: string | null;
  cat: string | null;
  catSrc: 'off' | null;
}

export interface ProbeReportData {
  run: string;
  asof: string;
  rows: ProbeRow[];
  join: { endpoint: number; name: number; none: number };
  model: null; // no estimated categories are produced in the app
  dir: { total: number; partner: number } | null;
}

const NOT_OAUTH = 'No OAuth metadata or WWW-Authenticate found';
const BLOCKED = 'CDN/WAF blocked the probe — not an OAuth answer';

/** Same URL, ignoring case in the host, a trailing slash and a fragment. */
export function normalizeUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = '';
    return (x.origin + x.pathname.replace(/\/+$/, '') + x.search).toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

const normName = (s: unknown) => String(s ?? '').trim().toLowerCase();

function reasonFor(e: EndpointResult): string | null {
  const c = e.classification;
  if (e.completedAt && c.status === 'complete') return null;
  if (!e.completedAt) return 'Probe did not finish';
  if (c.status === 'blocked-at-edge') return BLOCKED;
  if (c.status === 'not-oauth') return NOT_OAUTH;
  return c.statusNote || e.error || 'Probe error';
}

function challengeStatus(e: EndpointResult): string | null {
  const a = e.attempts.find((x) => x.response && x.response.status > 0);
  return a?.response ? String(a.response.status) : null;
}

function rowFor(e: EndpointResult): ProbeRow {
  const c = e.classification;
  const oauth = !!e.completedAt && c.status === 'complete';
  const dcr = oauth ? dcrState(e) : 'none';
  const scheme = e.wwwAuthenticate?.scheme;
  const auth = !oauth ? null : scheme && /bearer/i.test(scheme) ? 'Bearer' : c.apiKeyHint ? 'Key' : null;
  return {
    name: displayName(e),
    url: e.url,
    dcr: oauth ? (dcr !== 'none' ? 'Yes' : 'No') : null,
    cimd: oauth ? (isCimd(e) ? 'Yes' : 'No') : null,
    status: oauth ? 'Complete' : 'Not complete',
    reason: reasonFor(e),
    http: challengeStatus(e),
    prm: e.prm.found,
    auth,
    prov: c.providerFingerprint ?? null,
    dprobe: dcr === 'open' || dcr === 'gated' ? dcr : null,
    tier: null,
    added: null,
    // The category the endpoint was loaded with (a CSV). A directory join below replaces it with the directory's own.
    cat: e.category ?? null,
    catSrc: e.category ? 'off' : null,
  };
}

export function buildProbeReportData(endpoints: EndpointResult[], directory: Item[] | null, runDate: Date): ProbeReportData {
  const rows = endpoints.map(rowFor);
  const join = { endpoint: 0, name: 0, none: 0 };
  let dir: ProbeReportData['dir'] = null;

  if (directory) {
    const conns = directory.filter((i) => classify(i) === 'Connector');
    const byUrl = new Map<string, Item>();
    const byName = new Map<string, Item>();
    for (const c of conns) {
      for (const u of getEndpoints(c)) if (/^https?:/i.test(u)) if (!byUrl.has(normalizeUrl(u))) byUrl.set(normalizeUrl(u), c);
      const n = normName(c.name || c.title);
      if (n && !byName.has(n)) byName.set(n, c);
    }
    dir = { total: conns.length, partner: conns.filter((c) => c.verified_tier === 'partner').length };

    rows.forEach((r, i) => {
      let item = byUrl.get(normalizeUrl(r.url));
      if (item) join.endpoint++;
      else if ((item = byName.get(normName(endpoints[i].label)) ?? byName.get(normName(r.name)))) join.name++;
      if (!item) {
        join.none++;
        return;
      }
      r.name = String(item.name || item.title || r.name);
      r.tier = item.verified_tier ?? null;
      r.added = item.added_time ? String(item.added_time).slice(0, 7) : null;
      const hit = categoryOf(item);
      if (hit) {
        r.cat = `${hit[0]}:${hit[1]}`;
        r.catSrc = 'off';
      }
    });
  }

  const day = runDate.toISOString().slice(0, 10);
  return {
    run: runDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
    asof: day,
    rows,
    join,
    model: null,
    dir,
  };
}
