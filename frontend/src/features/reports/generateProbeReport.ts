import template from './probeReportTemplate.html?raw';
import { buildProbeReportData } from './buildProbeReportData';
import { fillTemplate } from './fillReportTemplate';
import type { Item } from '../claude-scraper/claudeDirectory';
import type { EndpointResult } from '../probe/lib/probeTypes';

export const probeReportFileName = (asof: string) => `mcp_auth_discovery_report_${asof}.html`;

/** The complete, self-contained HTML report for a probe run. */
export function generateProbeReportHtml(endpoints: EndpointResult[], directory: Item[] | null, runDate: Date) {
  const data = buildProbeReportData(endpoints, directory, runDate);
  return { html: fillTemplate(template, data), asof: data.asof, matched: data.join.endpoint + data.join.name };
}
