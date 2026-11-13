import template from './chatgptReportTemplate.html?raw';
import { buildChatGPTReportData } from './buildChatGPTReportData';
import { fillTemplate } from './fillReportTemplate';
import type { PsPlugin } from '../chatgpt-scraper/pluginStore';

export const chatgptReportFileName = (asof: string) => `chatgpt_plugins_dashboard_${asof}.html`;

/** The complete, self-contained HTML report for a ChatGPT plugin scrape. */
export function generateChatGPTReportHtml(plugins: PsPlugin[], cats: Array<{ slug: string; title: string }>, asOf: Date): { html: string; asof: string; plugins: number } {
  const data = buildChatGPTReportData(plugins, cats, asOf);
  return { html: fillTemplate(template, data), asof: data.asof, plugins: data.total };
}
