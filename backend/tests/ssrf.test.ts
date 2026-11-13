import { describe, it, expect } from 'vitest';
import { checkSSRF } from '../src/probe/ssrf';

describe('checkSSRF', () => {
  it('rejects plain HTTP unless allowed', async () => {
    await expect(checkSSRF('http://8.8.8.8/', false)).rejects.toThrow(/Only HTTPS/);
    await expect(checkSSRF('http://8.8.8.8/', true)).resolves.toBeUndefined();
  });

  it('rejects unsupported protocols and invalid URLs', async () => {
    await expect(checkSSRF('ftp://8.8.8.8/', true)).rejects.toThrow(/Unsupported protocol/);
    await expect(checkSSRF('not a url', true)).rejects.toThrow(/Invalid URL/);
  });

  it.each([
    'https://127.0.0.1/',
    'https://10.1.2.3/',
    'https://172.16.0.1/',
    'https://192.168.1.1/',
    'https://169.254.169.254/',
    'https://0.0.0.0/',
    'https://100.64.0.1/',
  ])('blocks private IPv4 %s', async (u) => {
    await expect(checkSSRF(u, false)).rejects.toThrow(/Blocked/);
  });

  it('allows public IPv4 literals', async () => {
    await expect(checkSSRF('https://8.8.8.8/', false)).resolves.toBeUndefined();
    await expect(checkSSRF('https://172.32.0.1/', false)).resolves.toBeUndefined();
  });

  it('blocks private IPv6 literals', async () => {
    await expect(checkSSRF('https://[::1]/', false)).rejects.toThrow(/Blocked/);
    await expect(checkSSRF('https://[fd00::1]/', false)).rejects.toThrow(/Blocked/);
    await expect(checkSSRF('https://[fe80::1]/', false)).rejects.toThrow(/Blocked/);
  });
});
