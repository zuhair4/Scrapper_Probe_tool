import type { EndpointResult, ProbeResponse } from './probeTypes';

// One-line, human-readable view of a response body for the CSV: JSON compacted, HTML stripped.
export function bodySnippet(r: ProbeResponse | null | undefined, max = 200): string {
  if (!r) return '';
  let s: string;
  if (r.bodyJson != null) {
    s = JSON.stringify(r.bodyJson);
  } else {
    s = r.bodyText ?? '';
    if (/html/i.test(r.contentType ?? '') || s.trimStart().startsWith('<')) {
      s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
    }
    s = s.replace(/\s+/g, ' ').trim();
  }
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

const cut = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n)}…` : s);

// The important facts about an endpoint's run, kept short: what the server answered to the
// challenge, where its metadata lives, and how the DCR probe responded (including the body).
export function summarizeDetails(e: EndpointResult): string {
  const parts: string[] = [];
  const c = e.classification;
  const complete = c.status === 'complete';

  if (!complete && (c.statusNote || e.error)) parts.push(`Result: ${c.statusNote ?? e.error}`);

  const post = e.attempts.find((a) => a.stepLabel.startsWith('Step 1 — Challenge POST'));
  const pr = post?.response;
  if (pr) {
    if (pr.status === 0) {
      parts.push(`Challenge POST: no response${pr.error ? ` (${cut(pr.error, 120)})` : ''}`);
    } else {
      const body = complete ? '' : bodySnippet(pr, 160);
      parts.push(`Challenge POST: HTTP ${pr.status}${body ? ` - ${body}` : ''}`);
    }
  }

  if (e.wwwAuthenticate?.raw) parts.push(`WWW-Authenticate: ${cut(e.wwwAuthenticate.raw)}`);

  parts.push(e.prm.found ? `PRM: ${e.prm.url}` : 'PRM: not found');

  const md = e.as.metadata;
  parts.push(e.as.found && md ? `AS metadata: ${e.as.url}${md.issuer ? ` (issuer ${md.issuer})` : ''}` : 'AS metadata: not found');

  if (c.providerFingerprint) parts.push(`Provider: ${c.providerFingerprint}`);

  const dcr = e.dcrResults[0];
  if (dcr) {
    const open = dcr.status === 200 || dcr.status === 201;
    const attempt = e.attempts.find((a) => a.stepLabel.startsWith('Step 4b'));
    const body = bodySnippet(attempt?.response, 240);
    parts.push(
      `DCR probe: HTTP ${dcr.status || 'error'} (${open ? 'open' : 'gated or rejected'})${body ? ` - ${body}` : ''}`
    );
  }

  return parts.join(' | ');
}
