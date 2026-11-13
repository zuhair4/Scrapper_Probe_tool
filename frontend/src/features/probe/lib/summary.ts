import type { EndpointResult } from './probeTypes';

export interface RunSummary {
  total: number;
  completed: number;
  oauth: number; // classified "complete": OAuth metadata or a WWW-Authenticate challenge found
  dcr: number; // advertises a registration_endpoint
  dcrOpen: number; // ...and the automatic probe was accepted (200/201)
  dcrGated: number; // ...but the probe was rejected or gated
  cimd: number; // client_id_metadata_document_supported
  preRegistered: number; // OAuth, but neither DCR nor CIMD
  pkceS256: number;
  publicClients: number;
  blockedAtEdge: number;
  notOauth: number;
  errors: number;
  unverified: number; // blocked at edge + not OAuth + errors: could not be confirmed either way
}

export type DcrState = 'open' | 'gated' | 'none';

export function isCimd(e: EndpointResult): boolean {
  return e.as.metadata?.client_id_metadata_document_supported === true;
}

export function dcrState(e: EndpointResult): DcrState {
  if (e.classification.registrationMode !== 'dcr') return 'none';
  const probe = e.dcrResults[0];
  if (probe && (probe.status === 200 || probe.status === 201)) return 'open';
  return 'gated';
}

export function summarize(endpoints: EndpointResult[]): RunSummary {
  const s: RunSummary = {
    total: endpoints.length,
    completed: 0,
    oauth: 0,
    dcr: 0,
    dcrOpen: 0,
    dcrGated: 0,
    cimd: 0,
    preRegistered: 0,
    pkceS256: 0,
    publicClients: 0,
    blockedAtEdge: 0,
    notOauth: 0,
    errors: 0,
    unverified: 0,
  };

  for (const e of endpoints) {
    if (!e.completedAt) continue;
    s.completed++;
    const c = e.classification;
    switch (c.status) {
      case 'blocked-at-edge':
        s.blockedAtEdge++;
        continue;
      case 'not-oauth':
        s.notOauth++;
        continue;
      case 'error':
        s.errors++;
        continue;
    }

    s.oauth++;
    const dcr = dcrState(e);
    const cimd = isCimd(e);
    if (dcr !== 'none') {
      s.dcr++;
      if (dcr === 'open') s.dcrOpen++;
      else s.dcrGated++;
    }
    if (cimd) s.cimd++;
    if (dcr === 'none' && !cimd) s.preRegistered++;
    if (c.hasPKCES256) s.pkceS256++;
    if (c.hasPublicClients) s.publicClients++;
  }
  s.unverified = s.blockedAtEdge + s.notOauth + s.errors;
  return s;
}
