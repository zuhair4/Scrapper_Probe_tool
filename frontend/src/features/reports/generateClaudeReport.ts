import template from './claudeReportTemplate.html?raw';
import { buildReportData } from './buildClaudeReportData';
import { fillTemplate } from './fillReportTemplate';
import type { Item } from '../claude-scraper/claudeDirectory';

/** The complete, self-contained HTML report for a scrape. */
export function generateReportHtml(items: Item[], asOf: Date): { html: string; asof: string; connectors: number } {
  const data = buildReportData(items, asOf);
  return { html: fillTemplate(template, data), asof: data.asof, connectors: data.total };
}
