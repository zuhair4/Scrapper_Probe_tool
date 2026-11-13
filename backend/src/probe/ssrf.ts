import { promises as dns } from 'dns';
import { isIPv4 } from 'net';

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return false;
  const [a, b] = parts;
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateIPv6(ip: string): boolean {
  const n = ip.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    n === '::1' ||
    n === '::' ||
    /^fc[0-9a-f]{2}:/.test(n) ||
    /^fd[0-9a-f]{2}:/.test(n) ||
    /^fe[89ab][0-9a-f]:/.test(n) ||
    n.startsWith('::ffff:127.') ||
    n.startsWith('::ffff:10.') ||
    n.startsWith('::ffff:192.168.') ||
    n.startsWith('::ffff:169.254.')
  );
}

function looksLikeIPv6(s: string): boolean {
  return s.includes(':');
}

// A probe makes ~10 requests to the same host; resolve A and AAAA in parallel and
// reuse the answer briefly. Failed lookups are not cached.
const DNS_TTL_MS = 30_000;
const dnsCache = new Map<string, { at: number; addresses: string[] }>();

async function resolveAddresses(hostname: string): Promise<string[]> {
  const hit = dnsCache.get(hostname);
  if (hit && Date.now() - hit.at < DNS_TTL_MS) return hit.addresses;

  const [v4, v6] = await Promise.all([
    dns.resolve4(hostname).catch(() => [] as string[]),
    dns.resolve6(hostname).catch(() => [] as string[]),
  ]);
  const addresses = [...v4, ...v6];
  if (addresses.length > 0) dnsCache.set(hostname, { at: Date.now(), addresses });
  return addresses;
}

export async function checkSSRF(url: string, allowHttp: boolean): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }

  if (!allowHttp && parsed.protocol !== 'https:') {
    throw new Error(
      `Only HTTPS URLs are allowed (got ${parsed.protocol}). Enable "Allow HTTP" in settings to permit plain HTTP.`
    );
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  if (isIPv4(hostname)) {
    if (isPrivateIPv4(hostname)) {
      throw new Error(`Blocked: ${hostname} is in a private/reserved IPv4 range`);
    }
    return;
  }

  if (looksLikeIPv6(hostname)) {
    if (isPrivateIPv6(hostname)) {
      throw new Error(`Blocked: ${hostname} is in a private/reserved IPv6 range`);
    }
    return;
  }

  const addresses = await resolveAddresses(hostname);

  if (addresses.length === 0) {
    throw new Error(`DNS resolution failed for ${hostname} — host not found`);
  }

  for (const addr of addresses) {
    if (isIPv4(addr) && isPrivateIPv4(addr)) {
      throw new Error(`Blocked: ${hostname} resolves to private IPv4 ${addr}`);
    }
    if (looksLikeIPv6(addr) && isPrivateIPv6(addr)) {
      throw new Error(`Blocked: ${hostname} resolves to private IPv6 ${addr}`);
    }
  }
}
