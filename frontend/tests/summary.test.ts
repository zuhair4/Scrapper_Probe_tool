import { describe, it, expect } from 'vitest';
import { classifyEndpoint } from '../src/features/probe/lib/classify';
import { dcrState, isCimd, summarize } from '../src/features/probe/lib/summary';
import type { ASMetadata, DCRProbeResult, EndpointResult } from '../src/features/probe/lib/probeTypes';

const url = 'https://mcp.example.com/mcp';

function ep(opts: {
  metadata?: ASMetadata;
  dcrStatus?: number;
  blocked?: boolean;
  www?: boolean;
  done?: boolean;
  error?: boolean;
}): EndpointResult {
  const prm = { found: false, resourceMismatch: false };
  const as = opts.metadata
    ? { found: true, metadata: opts.metadata, issuerMismatch: false }
    : { found: false, issuerMismatch: false };
  const www = opts.www ? { scheme: 'Bearer', raw: 'Bearer' } : undefined;
  const classification = classifyEndpoint(prm, as, www, false, !!opts.blocked, url);
  if (opts.error) classification.status = 'error';
  const dcrResults = (opts.dcrStatus === undefined ? [] : [{ variant: 'A', status: opts.dcrStatus }]) as unknown as DCRProbeResult[];
  return {
    id: Math.random().toString(),
    url,
    startedAt: 1,
    completedAt: opts.done === false ? undefined : 2,
    attempts: [],
    prm,
    as,
    classification,
    dcrResults,
  };
}

const dcrMeta: ASMetadata = {
  issuer: 'i',
  registration_endpoint: 'https://a/register',
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
};

describe('dcrState / isCimd', () => {
  it('open vs gated vs none', () => {
    expect(dcrState(ep({ metadata: dcrMeta, dcrStatus: 201 }))).toBe('open');
    expect(dcrState(ep({ metadata: dcrMeta, dcrStatus: 401 }))).toBe('gated');
    expect(dcrState(ep({ metadata: { issuer: 'i' } }))).toBe('none');
  });
  it('detects CIMD independently of DCR', () => {
    const both = ep({ metadata: { ...dcrMeta, client_id_metadata_document_supported: true }, dcrStatus: 401 });
    expect(isCimd(both)).toBe(true);
    expect(dcrState(both)).toBe('gated');
    expect(isCimd(ep({ metadata: dcrMeta, dcrStatus: 201 }))).toBe(false);
  });
});

describe('summarize', () => {
  it('counts DCR open/gated, CIMD, pre-registered and failures; ignores unfinished', () => {
    const s = summarize([
      ep({ metadata: dcrMeta, dcrStatus: 201 }),
      ep({ metadata: dcrMeta, dcrStatus: 403 }),
      ep({ metadata: { issuer: 'i', client_id_metadata_document_supported: true } }),
      ep({ metadata: { issuer: 'i' } }),
      ep({ blocked: true }),
      ep({}),
      ep({ error: true }),
      ep({ metadata: dcrMeta, dcrStatus: 201, done: false }),
    ]);
    expect(s.total).toBe(8);
    expect(s.completed).toBe(7);
    expect(s.oauth).toBe(4);
    expect(s.dcr).toBe(2);
    expect(s.dcrOpen).toBe(1);
    expect(s.dcrGated).toBe(1);
    expect(s.cimd).toBe(1);
    expect(s.preRegistered).toBe(1);
    expect(s.pkceS256).toBe(2);
    expect(s.publicClients).toBe(2);
    expect(s.blockedAtEdge).toBe(1);
    expect(s.notOauth).toBe(1);
    expect(s.errors).toBe(1);
    expect(s.unverified).toBe(3);
  });
});
