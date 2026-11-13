export type HttpMethod = 'GET' | 'POST';

export interface ProbeResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
  bodyJson: unknown;
  contentType: string;
  elapsedMs: number;
  finalUrl: string;
  redirectHops: string[];
  error?: string;
}

export type Fetcher = (req: {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  allowHttp?: boolean;
  delayMs?: number;
  timeoutMs?: number;
}) => Promise<ProbeResponse>;

export interface AttemptLog {
  id: string;
  stepLabel: string;
  url: string;
  method: HttpMethod;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  response: ProbeResponse | null;
  hit: boolean;
  note?: string;
  timestamp: number;
}

export interface ParsedWWWAuthenticate {
  scheme: string;
  resource_metadata?: string;
  error?: string;
  scope?: string;
  realm?: string;
  raw: string;
}

export interface PRMData {
  resource?: string;
  authorization_servers?: string[];
  scopes_supported?: string[];
  bearer_methods_supported?: string[];
  resource_documentation?: string;
  [key: string]: unknown;
}

export interface PRMResult {
  found: boolean;
  url?: string;
  urlForm?: 'www-authenticate' | 'path-inserted' | 'root' | 'path-appended';
  data?: PRMData;
  resourceMismatch: boolean;
  resourceMismatchNote?: string;
}

export interface ASMetadata {
  issuer: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  jwks_uri?: string;
  revocation_endpoint?: string;
  introspection_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  code_challenge_methods_supported?: string[];
  client_id_metadata_document_supported?: boolean;
  pushed_authorization_request_endpoint?: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  [key: string]: unknown;
}

export interface ASResult {
  found: boolean;
  url?: string;
  urlForm?: string;
  metadata?: ASMetadata;
  issuerMismatch: boolean;
  issuerMismatchNote?: string;
  issuerFromPRM?: string;
}

export type RegistrationMode = 'dcr' | 'cimd' | 'pre-registered';

export interface ClassificationResult {
  registrationMode: RegistrationMode;
  hasPublicClients: boolean;
  hasPKCES256: boolean;
  hasPlainPKCE: boolean;
  notableGrants: string[];
  missingRefreshToken: boolean;
  providerFingerprint?: string;
  multipleHosts: boolean;
  scopesMismatch: boolean;
  scopesMismatchNote?: string;
  apiKeyHint: boolean;
  status: 'complete' | 'blocked-at-edge' | 'not-oauth' | 'error';
  statusNote?: string;
}

export type DCRVariant = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface DCRProbeResult {
  variant: DCRVariant;
  variantLabel: string;
  status: number;
  clientId?: string;
  hasClientSecret: boolean;
  hasRegistrationAccessToken: boolean;
  hasRegistrationClientUri: boolean;
  grantedScope?: string;
  grantedGrantTypes?: string[];
  requestedGrantTypes: string[];
  grantWidening: boolean;
  grantDropping: boolean;
  clientSecretExpiresAt?: number;
  error?: string;
  errorDescription?: string;
}

export interface EndpointResult {
  id: string;
  label?: string;
  /** Taxonomy category the endpoint was loaded with (from a CSV), as "level:value", e.g. "dept:design". */
  category?: string;
  /** Name discovered from the endpoint (PRM resource_name, MCP serverInfo, realm, or hostname). */
  appName?: string;
  appNameSource?: string;
  url: string;
  startedAt: number;
  completedAt?: number;
  attempts: AttemptLog[];
  wwwAuthenticate?: ParsedWWWAuthenticate;
  prm: PRMResult;
  as: ASResult;
  classification: ClassificationResult;
  dcrResults: DCRProbeResult[];
  error?: string;
}

export type DCRVariantMap = Record<DCRVariant, boolean>;

export interface RunSettings {
  delayMs: number;
  timeoutMs: number;
  allowHttp: boolean;
  dcrEnabled: boolean;
  dcrConfirmed: boolean;
  dcrVariants: DCRVariantMap;
}

export const DEFAULT_SETTINGS: RunSettings = {
  delayMs: 100,
  timeoutMs: 10000,
  allowHttp: false,
  dcrEnabled: false,
  dcrConfirmed: false,
  dcrVariants: { A: true, B: false, C: false, D: false, E: false, F: false },
};

export interface RunState {
  id: string;
  label: string;
  startedAt: number;
  completedAt?: number;
  settings: RunSettings;
  endpoints: EndpointResult[];
  status: 'idle' | 'running' | 'paused' | 'cancelled' | 'complete';
}
