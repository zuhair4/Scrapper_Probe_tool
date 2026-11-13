import { classify, taxValues } from '../claude-scraper/claudeDirectory';
import type { Item } from '../claude-scraper/claudeDirectory';

// Builds the data object the dashboard template renders (its `const D = {...}`), from a scrape.
// Connectors only. Categories use the directory's own tags only (no estimated labels).

export type Level = 'dept' | 'industry' | 'life';

export interface ReportCategory {
  level: Level;
  label: string;
  off: Record<string, number>;
  pred: Record<string, number>;
  partner: number;
  total: number;
  ex: string[];
}

export interface ReportData {
  asof: string;
  total: number;
  dated: number;
  undated: number;
  months: string[];
  tot: number[];
  tiers: { partner: number[]; community: number[]; anthropic: number[] };
  daily: Array<[string, number]>;
  cats: Record<string, ReportCategory>;
  counts: { off: number; pred: number; dept: number; ind: number; life: number; cliff: string };
  upd: { n: number; fresh: number; later: number; first: string; neg: number };
  tier_all: { community: number; partner: number; anthropic: number };
  publishers: number;
  dupnames: number;
}

// One label per connector: department, else industry, else life area. The directory's object acted on is not used, so a
// connector that only has that tag is left uncategorized.
const LEVELS: Array<[string, Level]> = [
  ['work_department', 'dept'],
  ['industry', 'industry'],
  ['life_area', 'life'],
];

/** The one category a connector is filed under: department, else industry, else life area. */
export function categoryOf(item: Item): [Level, string] | null {
  for (const [field, level] of LEVELS) {
    const v = taxValues(item, field);
    if (v.length) return [level, String(v[0])];
  }
  return null;
}

export const MIN_MONTHS = 5; // the template compares against the previous four months
export const DAILY_DAYS = 63; // nine weeks, as in the original report
const DAY_MS = 86_400_000;

const ym = (d: Date) => d.toISOString().slice(0, 7);

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function buildReportData(items: Item[], asOf: Date): ReportData {
  const conns = items.filter((i) => classify(i) === 'Connector');
  const asofDay = asOf.toISOString().slice(0, 10);
  const asofMonth = asofDay.slice(0, 7);

  const monthOf = (i: Item): string | null => (i.added_time ? String(i.added_time).slice(0, 7) : null);
  const dated = conns.filter((c) => monthOf(c));
  const datedMonths = dated.map((c) => monthOf(c) as string).sort();

  // Contiguous months from the first launch to the as-of month, padded to at least MIN_MONTHS.
  const last = datedMonths.length && datedMonths[datedMonths.length - 1] > asofMonth ? datedMonths[datedMonths.length - 1] : asofMonth;
  let first = datedMonths.length ? datedMonths[0] : asofMonth;
  if (monthRange(first, last).length < MIN_MONTHS) first = addMonths(last, -(MIN_MONTHS - 1));
  const months = monthRange(first, last);
  const mi = new Map(months.map((m, i) => [m, i]));

  const tot = months.map(() => 0);
  const tiers = {
    partner: months.map(() => 0),
    community: months.map(() => 0),
    anthropic: months.map(() => 0),
  };
  for (const c of dated) {
    const i = mi.get(monthOf(c) as string);
    if (i === undefined) continue;
    tot[i]++;
    const t = c.verified_tier as keyof typeof tiers;
    if (tiers[t]) tiers[t][i]++;
  }

  // Daily launches over the last DAILY_DAYS days up to and including the as-of day.
  const dayCounts = new Map<string, number>();
  for (const c of dated) {
    const d = String(c.added_time).slice(0, 10);
    dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
  }
  const end = Date.parse(`${asofDay}T00:00:00Z`);
  const daily: Array<[string, number]> = [];
  for (let k = DAILY_DAYS - 1; k >= 0; k--) {
    const day = new Date(end - k * DAY_MS).toISOString().slice(0, 10);
    daily.push([day, dayCounts.get(day) ?? 0]);
  }

  // Official categories.
  const cats: Record<string, ReportCategory> = {};
  const latest: Record<string, Array<{ name: string; t: string }>> = {};
  const lvlCount: Record<Level, number> = { dept: 0, industry: 0, life: 0 };
  let off = 0;
  for (const c of conns) {
    const hit = categoryOf(c);
    if (!hit) continue;
    const [level, label] = hit;
    const key = `${level}:${label}`;
    const cat = (cats[key] ??= { level, label, off: {}, pred: {}, partner: 0, total: 0, ex: [] });
    cat.total++;
    if (c.verified_tier === 'partner') cat.partner++;
    const m = monthOf(c);
    if (m) cat.off[m] = (cat.off[m] ?? 0) + 1;
    (latest[key] ??= []).push({ name: String(c.name || c.title || ''), t: String(c.added_time ?? '') });
    lvlCount[level]++;
    off++;
  }
  for (const [key, list] of Object.entries(latest)) {
    cats[key].ex = list
      .filter((x) => x.name)
      .sort((a, b) => b.t.localeCompare(a.t))
      .slice(0, 3)
      .map((x) => x.name);
  }

  // Updated vs added dates.
  let n = 0;
  let fresh = 0;
  let later = 0;
  let neg = 0;
  let firstUpdated = '';
  for (const c of conns) {
    if (!c.updated_time) continue;
    n++;
    const u = String(c.updated_time).slice(0, 10);
    if (!firstUpdated || u < firstUpdated) firstUpdated = u;
    if (c.added_time) {
      const diff = Date.parse(c.updated_time) - Date.parse(c.added_time);
      if (diff < 0) neg++;
      else if (diff <= DAY_MS) fresh++;
      else later++;
    }
  }

  const tierAll = { community: 0, partner: 0, anthropic: 0 };
  for (const c of conns) {
    const t = c.verified_tier as keyof typeof tierAll;
    if (tierAll[t] !== undefined) tierAll[t]++;
  }

  const publishers = new Set<string>();
  const nameCounts = new Map<string, number>();
  for (const c of conns) {
    if (c.publisher?.name) publishers.add(String(c.publisher.name));
    const nm = String(c.name || c.title || '');
    if (nm) nameCounts.set(nm, (nameCounts.get(nm) ?? 0) + 1);
  }

  return {
    asof: asofDay,
    total: conns.length,
    dated: dated.length,
    undated: conns.length - dated.length,
    months,
    tot,
    tiers,
    daily,
    cats,
    counts: {
      off,
      pred: 0,
      dept: lvlCount.dept,
      ind: lvlCount.industry,
      life: lvlCount.life,
      cliff: '',
    },
    upd: { n, fresh, later, first: firstUpdated, neg },
    tier_all: tierAll,
    publishers: publishers.size,
    dupnames: [...nameCounts.values()].filter((v) => v > 1).length,
  };
}
