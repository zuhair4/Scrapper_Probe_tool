import type {
  PRMResult,
  ASResult,
  ASMetadata,
  ParsedWWWAuthenticate,
  ClassificationResult,
  ProbeResponse,
} from './probeTypes';

export function detectEdgeBlock(response: ProbeResponse): boolean {
  if (response.error) return false;
  if (response.status === 403 || response.status === 405) {
    const ct = (response.contentType ?? '').toLowerCase();
    if (ct.includes('text/html')) {
      const body = response.bodyText.toLowerCase();
      if (
        body.includes('cloudfront') ||
        body.includes('cloudflare') ||
        body.includes('access denied') ||
        body.includes('request blocked') ||
        body.includes('403 forbidden') ||
        body.includes('waf')
      ) {
        return true;
      }
    }
  }
  return false;
}

export function detectAPIKeyHint(response: ProbeResponse): boolean {
  const hasWWWAuth = 'www-authenticate' in response.headers;
  if (hasWWWAuth) return false;
  if (response.status !== 401 && response.status !== 403) return false;
  const body = (response.bodyText ?? '').toLowerCase();
  return (
    body.includes('api key') ||
    body.includes('api_key') ||
    body.includes('token not supplied') ||
    body.includes('x-api-key')
  );
}

function fingerprint(metadata: ASMetadata): string | undefined {
  const issuer = (metadata.issuer ?? '').toLowerCase();
  const authzEp = (metadata.authorization_endpoint ?? '').toLowerCase();
  const tokenEp = (metadata.token_endpoint ?? '').toLowerCase();
  const grants = metadata.grant_types_supported ?? [];

  if (issuer.includes('authkit.app') || authzEp.includes('authkit.app')) return 'WorkOS';

  if (
    issuer.includes('.auth0.com') ||
    authzEp.includes('.auth0.com') ||
    grants.some((g) => g.includes('http://auth0.com/oauth/grant-type'))
  )
    return 'Auth0';

  if (issuer.includes('stytch') || tokenEp.includes('stytch')) return 'Stytch';

  const keys = Object.keys(metadata);
  if (keys.includes('request_id') && keys.includes('status_code')) return 'Stytch';

  if (
    metadata.pushed_authorization_request_endpoint &&
    (issuer.includes('/oidc/') || authzEp.includes('/oidc/'))
  )
    return 'possibly node-oidc-provider';

  return undefined;
}

function collectHosts(metadata: ASMetadata, mcpUrl: string): Set<string> {
  const hosts = new Set<string>();
  try {
    hosts.add(new URL(mcpUrl).hostname);
  } catch {
    // ignore
  }
  const eps = [
    metadata.authorization_endpoint,
    metadata.token_endpoint,
    metadata.registration_endpoint,
  ];
  for (const ep of eps) {
    if (ep) {
      try {
        hosts.add(new URL(ep).hostname);
      } catch {
        // ignore
      }
    }
  }
  return hosts;
}

export function classifyEndpoint(
  prm: PRMResult | undefined,
  as: ASResult | undefined,
  wwwAuth: ParsedWWWAuthenticate | undefined,
  apiKeyHint: boolean,
  blockedAtEdge: boolean,
  mcpUrl: string
): ClassificationResult {
  const metadata = as?.metadata;

  let registrationMode: ClassificationResult['registrationMode'] = 'pre-registered';
  if (metadata?.registration_endpoint) {
    registrationMode = 'dcr';
  } else if (metadata?.client_id_metadata_document_supported === true) {
    registrationMode = 'cimd';
  }

  const authMethods = metadata?.token_endpoint_auth_methods_supported ?? [];
  const hasPublicClients = authMethods.includes('none');

  const pkce = metadata?.code_challenge_methods_supported ?? [];
  const hasPKCES256 = pkce.includes('S256');
  const hasPlainPKCE = pkce.includes('plain');

  const grants = metadata?.grant_types_supported ?? [];
  const notableGrants: string[] = [];
  const watchList: Record<string, string> = {
    client_credentials: 'client_credentials',
    'urn:ietf:params:oauth:grant-type:device_code': 'device_code',
    'urn:ietf:params:oauth:grant-type:jwt-bearer': 'jwt-bearer',
    implicit: 'implicit',
    password: 'password',
  };
  for (const [g, label] of Object.entries(watchList)) {
    if (grants.includes(g)) notableGrants.push(label);
  }

  const missingRefreshToken = grants.length > 0 && !grants.includes('refresh_token');
  const providerFingerprint = metadata ? fingerprint(metadata) : undefined;
  const multipleHosts = metadata ? collectHosts(metadata, mcpUrl).size > 1 : false;

  const prmScopes = new Set(prm?.data?.scopes_supported ?? []);
  const asScopes = new Set(metadata?.scopes_supported ?? []);
  let scopesMismatch = false;
  let scopesMismatchNote: string | undefined;
  if (prmScopes.size > 0 && asScopes.size > 0) {
    const prmOnly = [...prmScopes].filter((s) => !asScopes.has(s));
    const asOnly = [...asScopes].filter((s) => !prmScopes.has(s));
    if (prmOnly.length > 0 || asOnly.length > 0) {
      scopesMismatch = true;
      const parts: string[] = [];
      if (prmOnly.length) parts.push(`PRM-only: ${prmOnly.join(', ')}`);
      if (asOnly.length) parts.push(`AS-only: ${asOnly.join(', ')}`);
      scopesMismatchNote = parts.join('; ');
    }
  }

  let status: ClassificationResult['status'] = 'complete';
  let statusNote: string | undefined;

  if (blockedAtEdge) {
    status = 'blocked-at-edge';
    statusNote = 'CDN/WAF blocked the probe — not an OAuth answer';
  } else if (!as?.found && !prm?.found && !wwwAuth) {
    status = 'not-oauth';
    statusNote = 'No OAuth metadata or WWW-Authenticate found';
  }

  return {
    registrationMode,
    hasPublicClients,
    hasPKCES256,
    hasPlainPKCE,
    notableGrants,
    missingRefreshToken,
    providerFingerprint,
    multipleHosts,
    scopesMismatch,
    scopesMismatchNote,
    apiKeyHint,
    status,
    statusNote,
  };
}
