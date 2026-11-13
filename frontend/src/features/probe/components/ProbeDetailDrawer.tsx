import { useEffect, useState } from 'react';
import { generateCurl } from '../lib/curl';
import { flagsOf, statusOf } from './ProbeResultsTable';
import { displayName } from '../lib/appName';
import type { AttemptLog, EndpointResult } from '../lib/probeTypes';

interface Props {
  endpoint: EndpointResult;
  onClose: () => void;
}

type Tab = 'calls' | 'summary';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="text-xs uppercase tracking-wide font-bold text-[#5a7a1a] mb-2">{title}</h3>
      {children}
    </section>
  );
}

function KV({ k, v }: { k: string; v?: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm py-0.5">
      <span className="text-gray-500 w-44 shrink-0">{k}</span>
      <span className="break-all">{v ?? '—'}</span>
    </div>
  );
}

function CopyButton({ label, getText }: { label: string; getText: () => string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy:', getText());
    }
  };
  return (
    <button onClick={copy} className="px-2 py-1 rounded bg-[#f0f7e6] text-[#5a7a1a] text-xs font-semibold hover:bg-[#e3f0cc]">
      {copied ? 'Copied' : label}
    </button>
  );
}

const headerLines = (h: Record<string, string>) =>
  Object.entries(h)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

function prettyBody(text: string | undefined, json: unknown): string {
  if (json != null) return JSON.stringify(json, null, 2);
  if (!text) return '';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function statusClass(status: number | undefined) {
  if (status === undefined) return 'bg-gray-200 text-gray-600';
  if (status === 0) return 'bg-red-100 text-red-700';
  if (status < 300) return 'bg-[#f0f7e6] text-[#5a7a1a]';
  if (status < 400) return 'bg-blue-100 text-blue-700';
  if (status < 500) return 'bg-amber-100 text-amber-800';
  return 'bg-red-100 text-red-700';
}

function Block({ title, text, actions }: { title: string; text: string; actions?: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-gray-500 mb-1">
        <span>{title}</span>
        {actions}
      </div>
      <pre className="bg-gray-50 border border-gray-200 p-2 rounded overflow-x-auto max-h-80 text-xs whitespace-pre-wrap break-all">
        {text || '(empty)'}
      </pre>
    </div>
  );
}

function Call({ a, index, open, onToggle }: { a: AttemptLog; index: number; open: boolean; onToggle: () => void }) {
  const r = a.response;
  const body = prettyBody(r?.bodyText, r?.bodyJson);
  return (
    <div className={`border rounded mb-2 ${a.hit ? 'border-[#86BC25] bg-[#f7fbef]' : 'border-gray-200 bg-white'}`}>
      <button onClick={onToggle} className="w-full text-left px-3 py-2 flex items-center gap-2 text-xs">
        <span className="text-gray-400 w-5">{index + 1}</span>
        <span className="font-mono font-bold">{a.method}</span>
        <span className="font-semibold truncate">{a.stepLabel}</span>
        <span className="ml-auto flex items-center gap-2 shrink-0">
          {a.hit && <span className="text-[#5a7a1a] font-bold">HIT</span>}
          {r && <span className="text-gray-500">{r.elapsedMs} ms</span>}
          <span className={`px-2 py-0.5 rounded-full font-mono font-semibold ${statusClass(r?.status)}`}>
            {r ? (r.status === 0 ? 'ERR' : r.status) : '—'}
          </span>
          <span className="text-gray-400">{open ? '▾' : '▸'}</span>
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 text-xs space-y-3 border-t border-gray-100 pt-3">
          <div className="font-mono break-all">
            <span className="font-bold">{a.method}</span> {a.url}
          </div>
          {a.note && <div className="text-gray-600">{a.note}</div>}
          {r?.error && <div className="text-red-600 break-all">Error: {r.error}</div>}
          {r && r.redirectHops.length > 0 && (
            <div className="text-gray-600 break-all">Redirects: {r.redirectHops.join(' → ')} → {r.finalUrl}</div>
          )}

          <div className="flex gap-2">
            <CopyButton label="Copy curl" getText={() => generateCurl(a)} />
            {r && <CopyButton label="Copy response body" getText={() => body} />}
          </div>

          <div className="text-[11px] font-bold uppercase text-[#5a7a1a]">Request</div>
          <Block title="Request headers" text={headerLines(a.requestHeaders)} />
          {a.requestBody && <Block title="Request body" text={prettyBody(a.requestBody, null)} />}

          <div className="text-[11px] font-bold uppercase text-[#5a7a1a]">
            Response{r ? ` — ${r.status === 0 ? 'no response' : `${r.status} ${r.statusText}`}` : ''}
          </div>
          {r ? (
            <>
              <Block title="Response headers" text={headerLines(r.headers)} />
              <Block
                title={r.bodyJson != null ? 'Response body (raw JSON)' : 'Response body'}
                text={body.slice(0, 20000) + (body.length > 20000 ? '\n…(truncated for display)' : '')}
              />
            </>
          ) : (
            <div className="text-gray-500">No response recorded.</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DetailDrawer({ endpoint: e, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('calls');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const c = e.classification;
  const st = statusOf(e);
  const md = e.as.metadata;
  const flags = flagsOf(e);
  const allOpen = e.attempts.length > 0 && openIds.size === e.attempts.length;

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const tabBtn = (key: Tab, text: string) => (
    <button
      onClick={() => setTab(key)}
      className={`px-4 py-2 text-sm font-semibold border-b-2 ${
        tab === key ? 'border-[#86BC25] text-[#282728]' : 'border-transparent text-gray-500 hover:text-[#282728]'
      }`}
    >
      {text}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside className="w-full max-w-3xl bg-white h-full overflow-y-auto shadow-xl">
        <div className="bg-[#282728] text-white px-5 py-4 flex items-start gap-3">
          <div className="min-w-0">
            <div className="font-semibold">{displayName(e)}</div>
            <div className="font-mono text-xs text-[#9ca3af] break-all">{e.url}</div>
          </div>
          <span className={`ml-2 shrink-0 text-xs px-2 py-0.5 rounded-full font-semibold ${st.cls}`}>{st.text}</span>
          <button onClick={onClose} className="ml-auto text-2xl leading-none text-[#9ca3af] hover:text-white" aria-label="Close">
            ×
          </button>
        </div>
        <div className="h-1 bg-[#86BC25]" />

        <div className="sticky top-0 bg-white border-b border-gray-200 px-3 flex items-center z-10">
          {tabBtn('calls', `API calls (${e.attempts.length})`)}
          {tabBtn('summary', 'Summary')}
          {tab === 'calls' && e.attempts.length > 0 && (
            <button
              onClick={() => setOpenIds(allOpen ? new Set() : new Set(e.attempts.map((a) => a.id)))}
              className="ml-auto text-xs underline text-gray-600 pr-2"
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          )}
        </div>

        <div className="px-5 pb-8 pt-4">
          {tab === 'calls' && (
            <>
              {(c.statusNote || e.error) && (
                <div className="mb-3 text-sm rounded border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 break-all">
                  {c.statusNote ?? e.error}
                </div>
              )}
              {e.attempts.length === 0 ? (
                <p className="text-sm text-gray-500">No API calls recorded yet for this endpoint.</p>
              ) : (
                e.attempts.map((a, i) => (
                  <Call key={a.id} a={a} index={i} open={openIds.has(a.id)} onToggle={() => toggle(a.id)} />
                ))
              )}
            </>
          )}

          {tab === 'summary' && (
            <>
              <Section title="Summary">
                {(c.statusNote || e.error) && <KV k="Note" v={c.statusNote ?? e.error} />}
                <KV k="Registration mode" v={c.registrationMode} />
                <KV k="PKCE S256 / plain" v={`${c.hasPKCES256 ? 'yes' : 'no'} / ${c.hasPlainPKCE ? 'yes' : 'no'}`} />
                <KV k="Public clients" v={c.hasPublicClients ? 'yes' : 'no'} />
                <KV k="Provider" v={c.providerFingerprint} />
                <KV k="Notable grants" v={c.notableGrants.join(', ') || undefined} />
                {flags.length > 0 && <KV k="Flags" v={flags.join(', ')} />}
              </Section>

              {e.wwwAuthenticate && (
                <Section title="WWW-Authenticate">
                  <KV k="Scheme" v={e.wwwAuthenticate.scheme} />
                  <KV k="resource_metadata" v={e.wwwAuthenticate.resource_metadata} />
                  <KV k="scope" v={e.wwwAuthenticate.scope} />
                  <KV k="error" v={e.wwwAuthenticate.error} />
                  <KV k="realm" v={e.wwwAuthenticate.realm} />
                </Section>
              )}

              <Section title="Protected resource metadata (RFC 9728)">
                {e.prm.found ? (
                  <>
                    <KV k="Found at" v={`${e.prm.url} (${e.prm.urlForm})`} />
                    <KV k="resource" v={e.prm.data?.resource} />
                    <KV k="authorization_servers" v={e.prm.data?.authorization_servers?.join(', ')} />
                    <KV k="scopes_supported" v={e.prm.data?.scopes_supported?.join(', ')} />
                    {e.prm.resourceMismatchNote && <KV k="Mismatch" v={<span className="text-amber-700">{e.prm.resourceMismatchNote}</span>} />}
                  </>
                ) : (
                  <p className="text-sm text-gray-500">Not found.</p>
                )}
              </Section>

              <Section title="Authorization server metadata (RFC 8414 / OIDC)">
                {e.as.found && md ? (
                  <>
                    <KV k="Found at" v={`${e.as.url} (${e.as.urlForm})`} />
                    <KV k="issuer" v={md.issuer} />
                    <KV k="authorization_endpoint" v={md.authorization_endpoint} />
                    <KV k="token_endpoint" v={md.token_endpoint} />
                    <KV k="registration_endpoint" v={md.registration_endpoint} />
                    <KV k="grant_types_supported" v={md.grant_types_supported?.join(', ')} />
                    <KV k="token_endpoint_auth_methods" v={md.token_endpoint_auth_methods_supported?.join(', ')} />
                    <KV k="code_challenge_methods" v={md.code_challenge_methods_supported?.join(', ')} />
                    <KV k="scopes_supported" v={md.scopes_supported?.join(', ')} />
                    {e.as.issuerMismatchNote && <KV k="Mismatch" v={<span className="text-amber-700">{e.as.issuerMismatchNote}</span>} />}
                    {c.scopesMismatchNote && <KV k="Scopes mismatch" v={<span className="text-amber-700">{c.scopesMismatchNote}</span>} />}
                  </>
                ) : (
                  <p className="text-sm text-gray-500">Not found.</p>
                )}
              </Section>

              {e.dcrResults.length > 0 && (
                <Section title="Dynamic client registration (RFC 7591)">
                  {e.dcrResults.map((d, i) => (
                    <div key={i} className="border border-gray-200 rounded p-3 mb-2">
                      <div className="text-sm font-semibold">
                        {d.variant}: {d.variantLabel}{' '}
                        <span className={d.status === 200 || d.status === 201 ? 'text-[#5a7a1a]' : 'text-gray-500'}>
                          — HTTP {d.status || 'error'} ({d.status === 200 || d.status === 201 ? 'open' : 'gated/rejected'})
                        </span>
                      </div>
                      <KV k="client_id issued" v={d.clientId ? 'yes' : 'no'} />
                      <KV k="client_secret" v={d.hasClientSecret ? 'yes' : 'no'} />
                      <KV k="registration_access_token" v={d.hasRegistrationAccessToken ? 'yes' : 'no'} />
                      <KV k="Granted scope" v={d.grantedScope} />
                      <KV k="Grants" v={d.grantedGrantTypes?.join(', ') || undefined} />
                      {d.grantWidening && <KV k="Grant widening" v="server granted more than requested" />}
                      {d.grantDropping && d.status < 300 && d.status > 0 && <KV k="Grant dropping" v="server granted less than requested" />}
                      {d.error && <KV k="Error" v={`${d.error}${d.errorDescription ? ` — ${d.errorDescription}` : ''}`} />}
                    </div>
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
