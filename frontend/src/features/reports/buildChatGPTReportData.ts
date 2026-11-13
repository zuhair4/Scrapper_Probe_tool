import { MCP_STATUS_LABEL, MCP_STATUS_ORDER } from '../chatgpt-scraper/pluginStore';
import type { McpStatus, PsPlugin } from '../chatgpt-scraper/pluginStore';

// Builds the data object the ChatGPT dashboard template renders (its `const D = {...}`), from a scrape.

export const NOT_STATED = 'not stated';
export const TOP_DEVELOPERS = 25;
export const DAILY_DAYS = 63; // nine weeks, as in the Claude report
const DAY_MS = 86_400_000;

export interface ReportCategory {
  slug: string;
  title: string;
  total: number;
  remote: number;
  status: Partial<Record<McpStatus, number>>;
}

export interface ReportDeveloper {
  name: string;
  plugins: number;
  remote: number;
}

/** One row of the plugin table: short keys keep the embedded data small. */
export interface ReportPlugin {
  n: string; // name
  d: string; // developer
  c: string[]; // category titles
  s: McpStatus;
  u: string[]; // remote endpoint URLs
  a: string; // auth type of the first remote endpoint
  w: string; // website
}

export interface ChatGPTReportData {
  asof: string;
  total: number;
  withDetail: number;
  status: Record<McpStatus, number>;
  statusLabels: Record<McpStatus, string>;
  statusOrder: McpStatus[];
  remotePlugins: number;
  remoteServers: number;
  distinctUrls: number;
  localServers: number;
  categories: ReportCategory[];
  transport: Record<string, number>;
  authType: Record<string, number>;
  clientMode: Record<string, number>;
  developers: ReportDeveloper[];
  developerCount: number;
  months: string[];
  created: number[];
  /** Plugins created per month (parallel to `months`), split by MCP endpoint status. */
  createdStatus: Record<McpStatus, number[]>;
  dated: number;
  undated: number;
  /** Plugins created per day over the last DAILY_DAYS days up to and including the as-of day. */
  daily: Array<[string, number]>;
  dupnames: number;
  plugins: ReportPlugin[];
}

const ym = (d: Date) => d.toISOString().slice(0, 7);

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

const bump = (o: Record<string, number>, k: string) => {
  o[k] = (o[k] ?? 0) + 1;
};

/** The month (YYYY-MM) of an ISO timestamp, or null when it is missing or not a date. */
function monthOf(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : ym(new Date(t));
}

export function buildChatGPTReportData(plugins: PsPlugin[], cats: Array<{ slug: string; title: string }>, asOf: Date): ChatGPTReportData {
  const titleOf = new Map(cats.map((c) => [c.slug, c.title || c.slug]));
  const titles = (p: PsPlugin) => p.categories.map((s) => titleOf.get(s) ?? s);

  const status = Object.fromEntries(MCP_STATUS_ORDER.map((s) => [s, 0])) as Record<McpStatus, number>;
  const transport: Record<string, number> = {};
  const authType: Record<string, number> = {};
  const clientMode: Record<string, number> = {};
  const urls = new Set<string>();
  let remotePlugins = 0;
  let remoteServers = 0;
  let localServers = 0;
  let withDetail = 0;

  const catRows = new Map<string, ReportCategory>();
  for (const c of cats) catRows.set(c.slug, { slug: c.slug, title: c.title || c.slug, total: 0, remote: 0, status: {} });

  const devs = new Map<string, ReportDeveloper>();
  const nameCounts = new Map<string, number>();
  const createdMonths: string[] = [];
  const createdBy: Array<[string, McpStatus]> = [];

  for (const p of plugins) {
    status[p.mcpStatus]++;
    if (p.hasDetail) withDetail++;
    const isRemote = p.mcpStatus === 'remote';
    if (isRemote) remotePlugins++;

    for (const m of p.mcp) {
      if (/^https?:\/\//i.test(m.url)) {
        remoteServers++;
        urls.add(m.url);
        bump(transport, m.transport || NOT_STATED);
        bump(authType, m.authType || NOT_STATED);
        if (m.authType === 'oauth' || m.authType === 'mixed') bump(clientMode, m.clientMode || NOT_STATED);
      } else if (m.command) {
        localServers++;
      }
    }

    for (const slug of p.categories) {
      const row = catRows.get(slug) ?? { slug, title: titleOf.get(slug) ?? slug, total: 0, remote: 0, status: {} };
      catRows.set(slug, row);
      row.total++;
      if (isRemote) row.remote++;
      row.status[p.mcpStatus] = (row.status[p.mcpStatus] ?? 0) + 1;
    }

    const dev = p.developer.trim();
    if (dev) {
      const d = devs.get(dev) ?? { name: dev, plugins: 0, remote: 0 };
      d.plugins++;
      if (isRemote) d.remote++;
      devs.set(dev, d);
    }
    if (p.name) nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);

    const m = p.createdAt ? monthOf(p.createdAt) : null;
    if (m) {
      createdMonths.push(m);
      createdBy.push([m, p.mcpStatus]);
    }
  }

  // Contiguous months from the first created plugin to the later of the as-of month and the newest plugin.
  createdMonths.sort();
  const asofMonth = ym(asOf);
  const months: string[] = [];
  if (createdMonths.length) {
    const last = createdMonths[createdMonths.length - 1] > asofMonth ? createdMonths[createdMonths.length - 1] : asofMonth;
    for (let m = createdMonths[0]; m <= last; m = addMonths(m, 1)) months.push(m);
  }
  const created = months.map(() => 0);
  const at = new Map(months.map((m, i) => [m, i]));
  for (const m of createdMonths) created[at.get(m) as number]++;
  const createdStatus = Object.fromEntries(MCP_STATUS_ORDER.map((s) => [s, months.map(() => 0)])) as Record<McpStatus, number[]>;
  for (const [m, s] of createdBy) createdStatus[s][at.get(m) as number]++;

  const asofDay = asOf.toISOString().slice(0, 10);
  const dayCounts = new Map<string, number>();
  for (const p of plugins) {
    const t = p.createdAt ? Date.parse(p.createdAt) : NaN;
    if (Number.isNaN(t)) continue;
    const d = new Date(t).toISOString().slice(0, 10);
    dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
  }
  const end = Date.parse(`${asofDay}T00:00:00Z`);
  const daily: Array<[string, number]> = [];
  for (let k = DAILY_DAYS - 1; k >= 0; k--) {
    const day = new Date(end - k * DAY_MS).toISOString().slice(0, 10);
    daily.push([day, dayCounts.get(day) ?? 0]);
  }

  const byCount = (a: { total?: number; plugins?: number; title?: string; name?: string }, b: typeof a) =>
    (b.total ?? b.plugins ?? 0) - (a.total ?? a.plugins ?? 0) || (a.title ?? a.name ?? '').localeCompare(b.title ?? b.name ?? '');

  const rows: ReportPlugin[] = plugins.map((p) => {
    const remote = p.mcp.filter((m) => /^https?:\/\//i.test(m.url));
    return {
      n: p.name,
      d: p.developer,
      c: titles(p),
      s: p.mcpStatus,
      u: remote.map((m) => m.url),
      a: remote[0] ? remote[0].authType || NOT_STATED : '',
      w: /^https?:\/\//i.test(p.website) ? p.website : '',
    };
  });

  return {
    asof: asOf.toISOString().slice(0, 10),
    total: plugins.length,
    withDetail,
    status,
    statusLabels: MCP_STATUS_LABEL,
    statusOrder: MCP_STATUS_ORDER,
    remotePlugins,
    remoteServers,
    distinctUrls: urls.size,
    localServers,
    categories: [...catRows.values()].sort(byCount),
    transport,
    authType,
    clientMode,
    developers: [...devs.values()].sort(byCount).slice(0, TOP_DEVELOPERS),
    developerCount: devs.size,
    months,
    created,
    createdStatus,
    dated: createdMonths.length,
    undated: plugins.length - createdMonths.length,
    daily,
    dupnames: [...nameCounts.values()].filter((v) => v > 1).length,
    plugins: rows.sort((a, b) => a.n.localeCompare(b.n)),
  };
}
