import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildASCandidates,
  discoverEndpoint,
  parseWWWAuthenticate,
  resetDcrCounts,
} from '../src/features/probe/lib/discovery';
import { DEFAULT_SETTINGS } from '../src/features/probe/lib/probeTypes';
import type { Fetcher, ProbeResponse } from '../src/features/probe/lib/probeTypes';

const mk = (status: number, body?: unknown, headers: Record<string, string> = {}): ProbeResponse => ({
  status,
  statusText: '',
  headers,
  bodyText: body === undefined ? '' : JSON.stringify(body),
  bodyJson: body ?? null,
  contentType: body === undefined ? '' : 'application/json',
  elapsedMs: 1,
  finalUrl: '',
  redirectHops: [],
});

const err = (): ProbeResponse => ({ ...mk(0), statusText: 'Error', error: 'ECONNREFUSED' });

function routeFetcher(routes: Record<string, ProbeResponse>, calls: string[] = []): Fetcher {
  return async (req) => {
    const key = `${req.method} ${req.url}`;
    calls.push(key);
    return routes[key] ?? mk(404);
  };
}

beforeEach(() => resetDcrCounts());

describe('parseWWWAuthenticate', () => {
  it('parses Bearer parameters', () => {
    const p = parseWWWAuthenticate(
      'Bearer realm="mcp", resource_metadata="https://a.com/.well-known/oauth-protected-resource", scope="read", error="invalid_token"'
    );
    expect(p.scheme).toBe('Bearer');
    expect(p.realm).toBe('mcp');
    expect(p.resource_metadata).toBe('https://a.com/.well-known/oauth-protected-resource');
    expect(p.scope).toBe('read');
    expect(p.error).toBe('invalid_token');
  });
  it('handles a bare scheme', () => {
    expect(parseWWWAuthenticate('Bearer').scheme).toBe('Bearer');
  });
});

describe('buildASCandidates', () => {
  it('returns root forms for a bare origin', () => {
    expect(buildASCandidates('https://auth.example.com/').map((c) => c.url)).toEqual([
      'https://auth.example.com/.well-known/oauth-authorization-server',
      'https://auth.example.com/.well-known/openid-configuration',
    ]);
  });
  it('returns path forms first for issuers with a path', () => {
    const urls = buildASCandidates('https://x.com/tenant1').map((c) => c.url);
    expect(urls[0]).toBe('https://x.com/.well-known/oauth-authorization-server/tenant1');
    expect(urls[1]).toBe('https://x.com/.well-known/openid-configuration/tenant1');
    expect(urls).toContain('https://x.com/tenant1/.well-known/openid-configuration');
    expect(urls.length).toBe(6);
  });
  it('returns [] for an invalid issuer', () => {
    expect(buildASCandidates('nope')).toEqual([]);
  });
});

describe('discoverEndpoint', () => {
  const url = 'https://mcp.example.com/mcp';

  it('runs the full chain and auto-probes open DCR', async () => {
    const calls: string[] = [];
    const fetcher = routeFetcher(
      {
        [`POST ${url}`]: mk(401, undefined, {
          'www-authenticate': 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
        }),
        'GET https://mcp.example.com/.well-known/oauth-protected-resource/mcp': mk(200, {
          resource: url,
          authorization_servers: ['https://auth.example.com'],
          scopes_supported: ['read'],
        }),
        'GET https://auth.example.com/.well-known/oauth-authorization-server': mk(200, {
          issuer: 'https://auth.example.com',
          registration_endpoint: 'https://auth.example.com/register',
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
          scopes_supported: ['read'],
        }),
        'POST https://auth.example.com/register': mk(201, { client_id: 'abc', grant_types: ['authorization_code', 'refresh_token'] }),
      },
      calls
    );
    const attempts: string[] = [];
    const r = await discoverEndpoint(url, 'Ex', DEFAULT_SETTINGS, fetcher, (a) => attempts.push(a.stepLabel));

    expect(r.completedAt).toBeDefined();
    expect(r.wwwAuthenticate?.scheme).toBe('Bearer');
    expect(r.prm.found).toBe(true);
    expect(r.prm.urlForm).toBe('www-authenticate');
    expect(r.prm.resourceMismatch).toBe(false);
    expect(r.as.found).toBe(true);
    expect(r.as.issuerMismatch).toBe(false);
    expect(r.classification.registrationMode).toBe('dcr');
    expect(r.dcrResults).toHaveLength(1);
    expect(r.dcrResults[0].clientId).toBe('abc');
    expect(r.attempts).toHaveLength(attempts.length);
    expect(calls.filter((c) => c.startsWith('POST https://auth.example.com/register'))).toHaveLength(1);
  });

  it('flags resource and issuer mismatches', async () => {
    const fetcher = routeFetcher({
      'GET https://mcp.example.com/.well-known/oauth-protected-resource/mcp': mk(200, {
        resource: 'https://other.example.com',
        authorization_servers: ['https://auth.example.com/'],
      }),
      'GET https://auth.example.com/.well-known/oauth-authorization-server': mk(200, { issuer: 'https://auth.example.com' }),
    });
    const r = await discoverEndpoint(url, undefined, DEFAULT_SETTINGS, fetcher, () => {});
    expect(r.prm.resourceMismatch).toBe(true);
    expect(r.as.issuerMismatch).toBe(true);
    expect(r.dcrResults).toHaveLength(0);
  });

  it('reports an error when the host is unreachable', async () => {
    const r = await discoverEndpoint(url, undefined, DEFAULT_SETTINGS, async () => err(), () => {});
    expect(r.classification.status).toBe('error');
    expect(r.error).toBe('ECONNREFUSED');
    expect(r.attempts).toHaveLength(2);
  });

  it('classifies a non-OAuth endpoint', async () => {
    const r = await discoverEndpoint(url, undefined, DEFAULT_SETTINGS, routeFetcher({}), () => {});
    expect(r.classification.status).toBe('not-oauth');
  });

  it('rejects an invalid URL without calling the fetcher', async () => {
    const calls: string[] = [];
    const r = await discoverEndpoint('nope', undefined, DEFAULT_SETTINGS, routeFetcher({}, calls), () => {});
    expect(r.classification.status).toBe('error');
    expect(calls).toHaveLength(0);
  });
});
