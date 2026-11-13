export const PLACEHOLDER = '/*__REPORT_DATA__*/null';

// Characters that must not reach an inline <script> as-is. Connector names come from community
// submissions, so "</script>" or "<!--" in a name could otherwise break out of the data and run.
// U+2028 / U+2029 are valid in JSON but end a line in older JavaScript string literals.
// Built from char codes so the source has no backslash escapes that tools could rewrite.
const BACKSLASH = String.fromCharCode(92);
const ESCAPES: Array<[string, string]> = [
  ['<', '003c'],
  ['>', '003e'],
  ['&', '0026'],
  [String.fromCharCode(0x2028), '2028'],
  [String.fromCharCode(0x2029), '2029'],
];

/** JSON that is safe to place inside an inline <script>. */
export function safeJson(data: unknown): string {
  let out = JSON.stringify(data);
  for (const [ch, hex] of ESCAPES) out = out.split(ch).join(`${BACKSLASH}u${hex}`);
  return out;
}

export function fillTemplate(template: string, data: unknown): string {
  if (!template.includes(PLACEHOLDER)) throw new Error('Report template is missing its data placeholder');
  // A replacer function, so "$&" and friends inside the data are not treated as patterns.
  return template.replace(PLACEHOLDER, () => safeJson(data));
}

export const reportFileName = (asof: string) => `claude_connectors_dashboard_${asof}.html`;
