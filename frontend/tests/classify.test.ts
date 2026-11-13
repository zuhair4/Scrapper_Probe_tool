import { describe, it, expect } from 'vitest';
import { classifyEndpoint, detectAPIKeyHint, detectEdgeBlock } from '../src/features/probe/lib/classify';
import type { ASResult, PRMResult, ProbeResponse } from '../src/features/probe/lib/probeTypes';

const resp = (over: Partial<ProbeResponse>): ProbeResponse => ({
  status: 200,
  statusText: 'OK',
  headers: {},
  bodyText: '',
  bodyJson: null,
  contentType: '',
  elapsedMs: 1,
  finalUrl: '',
  redirectHops: [],
  ...over,
});

const noPrm: PRMResult = { found: false, resourceMismatch: false };
const asWith = (metadata: ASResult['metadata']): ASResult => ({
  found: true,
  metadata,
  issuerMismatch: false,
});

describe('detectEdgeBlock', () => {
  it('flags HTML 403 from a CDN', () => {
    expect(
      detectEdgeBlock(resp({ status: 403, contentType: 'text/html', bodyText: '<h1>CloudFront</h1>' }))
    ).toBe(true);
  });
  it('ignores JSON 403 and transport errors', () => {
    expect(detectEdgeBlock(resp({ status: 403, contentType: 'application/json', bodyText: 'waf' }))).toBe(false);
    expect(detectEdgeBlock(resp({ status: 0, error: 'x' }))).toBe(false);
  });
});

describe('detectAPIKeyHint', () => {
  it('detects api key bodies without WWW-Authenticate', () => {
    expect(detectAPIKeyHint(resp({ status: 401, bodyText: 'Missing API key' }))).toBe(true);
  });
  it('is false when WWW-Authenticate is present', () => {
    expect(
      detectAPIKeyHint(resp({ status: 401, headers: { 'www-authenticate': 'Bearer' }, bodyText: 'api key' }))
    ).toBe(false);
  });
});

describe('classifyEndpoint', () => {
  it('classifies DCR with PKCE and public clients', () => {
    const c = classifyEndpoint(
      noPrm,
      asWith({
        issuer: 'https://auth.example.com',
        registration_endpoint: 'https://auth.example.com/register',
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
      }),
      undefined,
      false,
      false,
      'https://mcp.example.com/mcp'
    );
    expect(c.registrationMode).toBe('dcr');
    expect(c.hasPublicClients).toBe(true);
    expect(c.hasPKCES256).toBe(true);
    expect(c.missingRefreshToken).toBe(false);
    expect(c.multipleHosts).toBe(true);
    expect(c.status).toBe('complete');
  });

  it('classifies CIMD and pre-registered', () => {
    const cimd = classifyEndpoint(noPrm, asWith({ issuer: 'i', client_id_metadata_document_supported: true }), undefined, false, false, 'https://a.com');
    expect(cimd.registrationMode).toBe('cimd');
    const pre = classifyEndpoint(noPrm, asWith({ issuer: 'i' }), undefined, false, false, 'https://a.com');
    expect(pre.registrationMode).toBe('pre-registered');
  });

  it('collects notable grants and detects missing refresh_token', () => {
    const c = classifyEndpoint(
      noPrm,
      asWith({ issuer: 'i', grant_types_supported: ['client_credentials', 'password'] }),
      undefined,
      false,
      false,
      'https://a.com'
    );
    expect(c.notableGrants).toEqual(['client_credentials', 'password']);
    expect(c.missingRefreshToken).toBe(true);
  });

  it('fingerprints providers', () => {
    const f = (issuer: string, extra = {}) =>
      classifyEndpoint(noPrm, asWith({ issuer, ...extra }), undefined, false, false, 'https://a.com').providerFingerprint;
    expect(f('https://x.authkit.app')).toBe('WorkOS');
    expect(f('https://t.us.auth0.com/')).toBe('Auth0');
    expect(f('https://stytch.com/x')).toBe('Stytch');
    expect(f('https://x.com/oidc/', { pushed_authorization_request_endpoint: 'https://x.com/par' })).toBe('possibly node-oidc-provider');
    expect(f('https://plain.example.com')).toBeUndefined();
  });

  it('reports scope mismatch between PRM and AS', () => {
    const prm: PRMResult = { found: true, resourceMismatch: false, data: { scopes_supported: ['a', 'b'] } };
    const c = classifyEndpoint(prm, asWith({ issuer: 'i', scopes_supported: ['b', 'c'] }), undefined, false, false, 'https://a.com');
    expect(c.scopesMismatch).toBe(true);
    expect(c.scopesMismatchNote).toBe('PRM-only: a; AS-only: c');
  });

  it('sets blocked-at-edge and not-oauth statuses', () => {
    expect(classifyEndpoint(noPrm, undefined, undefined, false, true, 'https://a.com').status).toBe('blocked-at-edge');
    expect(classifyEndpoint(noPrm, { found: false, issuerMismatch: false }, undefined, false, false, 'https://a.com').status).toBe('not-oauth');
  });
});
