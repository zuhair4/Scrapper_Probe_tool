import type {
  Fetcher,
  ProbeResponse,
  AttemptLog,
  ParsedWWWAuthenticate,
  PRMResult,
  PRMData,
  ASResult,
  ASMetadata,
  EndpointResult,
  RunSettings,
  DCRProbeResult,
  DCRVariant,
  ClassificationResult,
} from './probeTypes';
import { detectEdgeBlock, detectAPIKeyHint, classifyEndpoint } from './classify';
import { deriveAppName, parseServerName } from './appName';

let _counter = 0;
function nextId() {
  return `a${++_counter}-${Date.now()}`;
}

// ─── WWW-Authenticate parser ────────────────────────────────────────────────

export function parseWWWAuthenticate(header: string): ParsedWWWAuthenticate {
  const result: ParsedWWWAuthenticate = { scheme: '', raw: header };
  const spaceIdx = header.indexOf(' ');
  if (spaceIdx === -1) {
    result.scheme = header.trim();
    return result;
  }
  result.scheme = header.slice(0, spaceIdx).trim();
  const rest = header.slice(spaceIdx + 1);
  const re = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    const [, key, value] = m;
    switch (key) {
      case 'resource_metadata':
        result.resource_metadata = value;
        break;
      case 'error':
        result.error = value;
        break;
      case 'scope':
        result.scope = value;
        break;
      case 'realm':
        result.realm = value;
        break;
    }
  }
  return result;
}

function isJsonWithFields(bodyJson: unknown, ...fields: string[]): boolean {
  if (!bodyJson || typeof bodyJson !== 'object' || Array.isArray(bodyJson)) return false;
  const obj = bodyJson as Record<string, unknown>;
  return fields.some((f) => f in obj);
}

// ─── Step 1: Challenge probe ─────────────────────────────────────────────────

const GET_TIMEOUT_MS = 4000;

async function challengeProbe(
  endpointUrl: string,
  settings: RunSettings,
  fetcher: Fetcher,
  onAttempt: (a: AttemptLog) => void
): Promise<{
  wwwAuthenticate?: ParsedWWWAuthenticate;
  blockedAtEdge: boolean;
  apiKeyHint: boolean;
  challengeStatus: number;
  unreachableError?: string;
  serverName?: string;
}> {
  const mcpBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'probe', version: '1.0' },
    },
  });

  const postHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-06-18',
  };

  const postResponse = await fetcher({
    method: 'POST',
    url: endpointUrl,
    headers: postHeaders,
    body: mcpBody,
    allowHttp: settings.allowHttp,
    delayMs: settings.delayMs,
    timeoutMs: settings.timeoutMs,
  });

  const edgeBlock = detectEdgeBlock(postResponse);
  const apiKeyHintPost = detectAPIKeyHint(postResponse);

  let wwwAuthenticate: ParsedWWWAuthenticate | undefined;
  const wwwRaw = postResponse.headers['www-authenticate'];
  if (wwwRaw) wwwAuthenticate = parseWWWAuthenticate(wwwRaw);

  onAttempt({
    id: nextId(),
    stepLabel: 'Step 1 — Challenge POST (MCP initialize)',
    url: endpointUrl,
    method: 'POST',
    requestHeaders: postHeaders,
    requestBody: mcpBody,
    response: postResponse,
    hit: false,
    note: edgeBlock ? 'Blocked at edge (CDN/WAF — not an OAuth answer)' : undefined,
    timestamp: Date.now(),
  });

  const getHeaders = {
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-06-18',
  };

  // The GET only matters when the POST gave no challenge and wasn't accepted outright. On open
  // streamable-HTTP servers it can hold an SSE stream open until the timeout, so a 2xx POST skips
  // it and any other case gets a short timeout of its own.
  const postAccepted = postResponse.status >= 200 && postResponse.status < 300;
  let getResponse: ProbeResponse | null = null;
  if (!wwwAuthenticate && !postAccepted) {
    getResponse = await fetcher({
      method: 'GET',
      url: endpointUrl,
      headers: getHeaders,
      allowHttp: settings.allowHttp,
      delayMs: settings.delayMs,
      timeoutMs: Math.min(settings.timeoutMs, GET_TIMEOUT_MS),
    });

    const raw2 = getResponse.headers['www-authenticate'];
    if (raw2) wwwAuthenticate = parseWWWAuthenticate(raw2);

    onAttempt({
      id: nextId(),
      stepLabel: 'Step 1 — Challenge GET',
      url: endpointUrl,
      method: 'GET',
      requestHeaders: getHeaders,
      response: getResponse,
      hit: false,
      timestamp: Date.now(),
    });
  }

  const apiKeyHint = apiKeyHintPost || (getResponse ? detectAPIKeyHint(getResponse) : false);

  const unreachableError =
    postResponse.status === 0 && getResponse?.status === 0
      ? (postResponse.error ?? getResponse.error ?? 'Host unreachable')
      : undefined;

  return {
    wwwAuthenticate,
    blockedAtEdge: edgeBlock,
    apiKeyHint,
    challengeStatus: postResponse.status,
    unreachableError,
    serverName: parseServerName(postResponse),
  };
}

// ─── Step 2: Protected Resource Metadata ────────────────────────────────────

function buildPRMCandidates(
  endpointUrl: string,
  wwwAuthMeta?: string
): Array<{ url: string; form: PRMResult['urlForm'] }> {
  const parsed = new URL(endpointUrl);
  const origin = parsed.origin;
  let path = parsed.pathname.replace(/\/$/, '');

  const candidates: Array<{ url: string; form: PRMResult['urlForm'] }> = [];

  if (wwwAuthMeta) {
    candidates.push({ url: wwwAuthMeta, form: 'www-authenticate' });
  }
  if (path) {
    candidates.push({
      url: `${origin}/.well-known/oauth-protected-resource${path}`,
      form: 'path-inserted',
    });
  }
  candidates.push({
    url: `${origin}/.well-known/oauth-protected-resource`,
    form: 'root',
  });
  candidates.push({
    url: `${endpointUrl.replace(/\/$/, '')}/.well-known/oauth-protected-resource`,
    form: 'path-appended',
  });

  // Deduplicate
  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
}

async function probePRM(
  endpointUrl: string,
  wwwAuthMeta: string | undefined,
  settings: RunSettings,
  fetcher: Fetcher,
  onAttempt: (a: AttemptLog) => void
): Promise<PRMResult> {
  const candidates = buildPRMCandidates(endpointUrl, wwwAuthMeta);

  for (const { url, form } of candidates) {
    const headers = { Accept: 'application/json' };
    const response = await fetcher({
      method: 'GET',
      url,
      headers,
      allowHttp: settings.allowHttp,
      delayMs: settings.delayMs,
      timeoutMs: settings.timeoutMs,
    });

    const hit =
      response.status === 200 &&
      isJsonWithFields(response.bodyJson, 'authorization_servers', 'resource');

    onAttempt({
      id: nextId(),
      stepLabel: `Step 2 — PRM (${form ?? 'unknown'})`,
      url,
      method: 'GET',
      requestHeaders: headers,
      response,
      hit,
      timestamp: Date.now(),
    });

    if (hit) {
      const data = response.bodyJson as PRMData;
      let resourceMismatch = false;
      let resourceMismatchNote: string | undefined;

      if (data.resource) {
        const norm = (s: string) => s.replace(/\/$/, '');
        if (norm(data.resource) !== norm(endpointUrl)) {
          resourceMismatch = true;
          resourceMismatchNote = `PRM resource "${data.resource}" ≠ endpoint "${endpointUrl}"`;
        }
      }

      return { found: true, url, urlForm: form, data, resourceMismatch, resourceMismatchNote };
    }
  }

  return { found: false, resourceMismatch: false };
}

// ─── Step 3: Authorization Server Metadata ──────────────────────────────────

export function buildASCandidates(
  issuer: string
): Array<{ url: string; form: string }> {
  const noSlash = issuer.replace(/\/$/, '');
  let origin: string;
  let path: string;

  try {
    const parsed = new URL(noSlash);
    origin = parsed.origin;
    path = parsed.pathname === '/' ? '' : parsed.pathname;
  } catch {
    return [];
  }

  const candidates: Array<{ url: string; form: string }> = [];

  if (path && path !== '/') {
    // a) RFC 8414 path-inserted
    candidates.push({
      url: `${origin}/.well-known/oauth-authorization-server${path}`,
      form: 'RFC 8414 path-inserted',
    });
    // b) OIDC path-inserted
    candidates.push({
      url: `${origin}/.well-known/openid-configuration${path}`,
      form: 'OIDC path-inserted',
    });
    // c) OIDC path-appended
    candidates.push({
      url: `${noSlash}/.well-known/openid-configuration`,
      form: 'OIDC path-appended',
    });
    // d) OAuth path-appended
    candidates.push({
      url: `${noSlash}/.well-known/oauth-authorization-server`,
      form: 'OAuth path-appended',
    });
  }
  // e) Root OAuth
  candidates.push({
    url: `${origin}/.well-known/oauth-authorization-server`,
    form: 'root OAuth',
  });
  // f) Root OIDC
  candidates.push({
    url: `${origin}/.well-known/openid-configuration`,
    form: 'root OIDC',
  });

  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
}

async function probeAS(
  issuers: string[],
  settings: RunSettings,
  fetcher: Fetcher,
  onAttempt: (a: AttemptLog) => void
): Promise<ASResult> {
  for (const issuer of issuers) {
    const candidates = buildASCandidates(issuer);

    for (const { url, form } of candidates) {
      const headers = { Accept: 'application/json' };
      const response = await fetcher({
        method: 'GET',
        url,
        headers,
        allowHttp: settings.allowHttp,
        delayMs: settings.delayMs,
        timeoutMs: settings.timeoutMs,
      });

      const hit = response.status === 200 && isJsonWithFields(response.bodyJson, 'issuer');

      onAttempt({
        id: nextId(),
        stepLabel: `Step 3 — AS metadata (${form})`,
        url,
        method: 'GET',
        requestHeaders: headers,
        response,
        hit,
        timestamp: Date.now(),
      });

      if (hit) {
        const metadata = response.bodyJson as ASMetadata;
        // Exact string match including trailing slash
        const issuerMismatch = metadata.issuer !== issuer;
        const issuerMismatchNote = issuerMismatch
          ? `metadata.issuer "${metadata.issuer}" ≠ authorization_servers entry "${issuer}"`
          : undefined;

        return {
          found: true,
          url,
          urlForm: form,
          metadata,
          issuerMismatch,
          issuerMismatchNote,
          issuerFromPRM: issuer,
        };
      }
    }
  }

  return { found: false, issuerMismatch: false };
}

// ─── Step 4b: DCR auto-probe ─────────────────────────────────────────────────
// Runs automatically whenever a registration_endpoint is found — no opt-in.
// Uses a single minimal public-client body to determine open vs gated.

async function autoProbeDCR(
  registrationEndpoint: string,
  discoveredScopes: string[],
  settings: RunSettings,
  fetcher: Fetcher,
  onAttempt: (a: AttemptLog) => void
): Promise<DCRProbeResult> {
  const preferredScope =
    discoveredScopes.find((s) => s.toLowerCase().includes('read')) ||
    discoveredScopes[0] ||
    'read';

  const requestBody = {
    client_name: 'probe-client-auto',
    redirect_uris: ['https://teamz.example.com/oauth-redirect'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: preferredScope,
  };
  const bodyStr = JSON.stringify(requestBody);
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };

  const response = await fetcher({
    method: 'POST',
    url: registrationEndpoint,
    headers,
    body: bodyStr,
    allowHttp: settings.allowHttp,
    delayMs: settings.delayMs,
    timeoutMs: settings.timeoutMs,
  });

  const hit = response.status === 200 || response.status === 201;

  onAttempt({
    id: nextId(),
    stepLabel: 'Step 4b — DCR auto-probe (public client)',
    url: registrationEndpoint,
    method: 'POST',
    requestHeaders: headers,
    requestBody: bodyStr,
    response,
    hit,
    note: hit
      ? 'DCR is open — registration succeeded'
      : `DCR gated or rejected (${response.status})`,
    timestamp: Date.now(),
  });

  const respBody = (response.bodyJson ?? {}) as Record<string, unknown>;
  const requestedGrants = requestBody.grant_types;
  const grantedGrants = (respBody.grant_types as string[] | undefined) ?? [];

  return {
    variant: 'A',
    variantLabel: 'Auto-probe — public client, Vertex AI Search redirect',
    status: response.status,
    clientId: respBody.client_id as string | undefined,
    hasClientSecret: 'client_secret' in respBody,
    hasRegistrationAccessToken: 'registration_access_token' in respBody,
    hasRegistrationClientUri: 'registration_client_uri' in respBody,
    grantedScope: respBody.scope as string | undefined,
    grantedGrantTypes: grantedGrants,
    requestedGrantTypes: requestedGrants,
    grantWidening: grantedGrants.some((g) => !requestedGrants.includes(g)),
    grantDropping: requestedGrants.some((g) => !grantedGrants.includes(g)),
    clientSecretExpiresAt: respBody.client_secret_expires_at as number | undefined,
    error: respBody.error as string | undefined,
    errorDescription: respBody.error_description as string | undefined,
  };
}

// ─── Step 6: DCR Probes ──────────────────────────────────────────────────────

const DCR_PROBE_LIMIT = 4;
const dcrCounts = new Map<string, number>();

export function resetDcrCounts(): void {
  dcrCounts.clear();
}

async function runDCRProbes(
  registrationEndpoint: string,
  discoveredScopes: string[],
  settings: RunSettings,
  fetcher: Fetcher,
  onAttempt: (a: AttemptLog) => void
): Promise<DCRProbeResult[]> {
  const results: DCRProbeResult[] = [];
  let serverKey: string;
  try {
    serverKey = new URL(registrationEndpoint).hostname;
  } catch {
    return results;
  }

  const preferredScope =
    discoveredScopes.find((s) => s.toLowerCase().includes('read')) ||
    discoveredScopes[0] ||
    'read';

  type VariantDef = {
    variant: DCRVariant;
    label: string;
    body: Record<string, unknown>;
    enabled: boolean;
  };

  const variants: VariantDef[] = [
    {
      variant: 'A',
      label: 'Public client, localhost redirect',
      enabled: settings.dcrVariants.A,
      body: {
        client_name: 'probe-client-A',
        redirect_uris: ['http://localhost:8080/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: preferredScope,
      },
    },
    {
      variant: 'B',
      label: 'Public client, HTTPS redirect',
      enabled: settings.dcrVariants.B,
      body: {
        client_name: 'probe-client-B',
        redirect_uris: ['https://example.com/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: preferredScope,
      },
    },
    {
      variant: 'C',
      label: 'Claude AI callback',
      enabled: settings.dcrVariants.C,
      body: {
        client_name: 'probe-client-C',
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: preferredScope,
      },
    },
    {
      variant: 'D',
      label: 'Confidential client',
      enabled: settings.dcrVariants.D,
      body: {
        client_name: 'probe-client-D',
        redirect_uris: ['https://example.com/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
        scope: preferredScope,
      },
    },
    {
      variant: 'E',
      label: 'Client credentials grant',
      enabled: settings.dcrVariants.E,
      body: {
        client_name: 'probe-client-E',
        grant_types: ['client_credentials'],
        token_endpoint_auth_method: 'client_secret_post',
        scope: preferredScope,
      },
    },
    {
      variant: 'F',
      label: 'Device code grant',
      enabled: settings.dcrVariants.F,
      body: {
        client_name: 'probe-client-F',
        grant_types: ['urn:ietf:params:oauth:grant-type:device_code'],
        token_endpoint_auth_method: 'none',
        scope: preferredScope,
      },
    },
  ];

  for (const v of variants) {
    if (!v.enabled) continue;
    const count = dcrCounts.get(serverKey) ?? 0;
    if (count >= DCR_PROBE_LIMIT) break;
    dcrCounts.set(serverKey, count + 1);

    const bodyStr = JSON.stringify(v.body);
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };

    const response = await fetcher({
      method: 'POST',
      url: registrationEndpoint,
      headers,
      body: bodyStr,
      allowHttp: settings.allowHttp,
      delayMs: settings.delayMs,
      timeoutMs: settings.timeoutMs,
    });

    const hit = response.status === 200 || response.status === 201;

    onAttempt({
      id: nextId(),
      stepLabel: `Step 6 — DCR ${v.variant}: ${v.label}`,
      url: registrationEndpoint,
      method: 'POST',
      requestHeaders: headers,
      requestBody: bodyStr,
      response,
      hit,
      timestamp: Date.now(),
    });

    const body = (response.bodyJson ?? {}) as Record<string, unknown>;
    const requestedGrants = v.body.grant_types as string[];
    const grantedGrants = (body.grant_types as string[] | undefined) ?? [];

    results.push({
      variant: v.variant,
      variantLabel: v.label,
      status: response.status,
      clientId: body.client_id as string | undefined,
      hasClientSecret: 'client_secret' in body,
      hasRegistrationAccessToken: 'registration_access_token' in body,
      hasRegistrationClientUri: 'registration_client_uri' in body,
      grantedScope: body.scope as string | undefined,
      grantedGrantTypes: grantedGrants,
      requestedGrantTypes: requestedGrants,
      grantWidening: grantedGrants.some((g) => !requestedGrants.includes(g)),
      grantDropping: requestedGrants.some((g) => !grantedGrants.includes(g)),
      clientSecretExpiresAt: body.client_secret_expires_at as number | undefined,
      error: body.error as string | undefined,
      errorDescription: body.error_description as string | undefined,
    });
  }

  return results;
}

// ─── Main entry point ────────────────────────────────────────────────────────

export async function discoverEndpoint(
  url: string,
  label: string | undefined,
  settings: RunSettings,
  fetcher: Fetcher,
  onAttempt: (a: AttemptLog) => void,
  onProgress?: (phase: string) => void
): Promise<EndpointResult> {
  const id = `ep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const startedAt = Date.now();
  const attempts: AttemptLog[] = [];
  const record = (a: AttemptLog) => {
    attempts.push(a);
    onAttempt(a);
  };

  let wwwAuthenticate: ParsedWWWAuthenticate | undefined;
  let prm: PRMResult = { found: false, resourceMismatch: false };
  let as: ASResult = { found: false, issuerMismatch: false };
  let dcrResults: DCRProbeResult[] = [];
  let apiKeyHint = false;
  let blockedAtEdge = false;
  let serverName: string | undefined;

  const finish = (error?: string): EndpointResult => {
    const app = deriveAppName({ serverName, prm, wwwAuth: wwwAuthenticate, url });
    const classification: ClassificationResult = classifyEndpoint(
      prm,
      as,
      wwwAuthenticate,
      apiKeyHint,
      blockedAtEdge,
      url
    );
    if (error) {
      classification.status = 'error';
      classification.statusNote = error;
    }
    return {
      id,
      label,
      appName: app.name,
      appNameSource: app.source,
      url,
      startedAt,
      completedAt: Date.now(),
      attempts,
      wwwAuthenticate,
      prm,
      as,
      classification,
      dcrResults,
      error,
    };
  };

  try {
    try {
      new URL(url);
    } catch {
      return finish(`Invalid URL: ${url}`);
    }

    onProgress?.('Challenge probe');
    const challenge = await challengeProbe(url, settings, fetcher, record);
    wwwAuthenticate = challenge.wwwAuthenticate;
    blockedAtEdge = challenge.blockedAtEdge;
    apiKeyHint = challenge.apiKeyHint;
    serverName = challenge.serverName;

    if (challenge.unreachableError) {
      return finish(challenge.unreachableError);
    }

    onProgress?.('Protected resource metadata');
    prm = await probePRM(url, wwwAuthenticate?.resource_metadata, settings, fetcher, record);

    // Without PRM authorization_servers, fall back to the endpoint origin
    // (legacy servers that act as their own authorization server).
    const fromPRM = (prm.data?.authorization_servers ?? []).filter(
      (s): s is string => typeof s === 'string' && s.length > 0
    );
    const issuers = fromPRM.length > 0 ? fromPRM : [new URL(url).origin];

    onProgress?.('Authorization server metadata');
    as = await probeAS(issuers, settings, fetcher, record);

    const registrationEndpoint = as.metadata?.registration_endpoint;
    if (registrationEndpoint) {
      const scopes = as.metadata?.scopes_supported ?? prm.data?.scopes_supported ?? [];
      onProgress?.('DCR probe');
      dcrResults.push(await autoProbeDCR(registrationEndpoint, scopes, settings, fetcher, record));

      if (settings.dcrEnabled && settings.dcrConfirmed) {
        dcrResults = dcrResults.concat(
          await runDCRProbes(registrationEndpoint, scopes, settings, fetcher, record)
        );
      }
    }

    onProgress?.('Classifying');
    return finish();
  } catch (err) {
    return finish(err instanceof Error ? err.message : String(err));
  }
}
