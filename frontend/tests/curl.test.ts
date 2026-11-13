import { describe, it, expect } from 'vitest';
import { generateCurl } from '../src/features/probe/lib/curl';
import type { AttemptLog } from '../src/features/probe/lib/probeTypes';

const base: AttemptLog = {
  id: 'a1',
  stepLabel: 'test',
  url: 'https://example.com/mcp',
  method: 'GET',
  requestHeaders: { Accept: 'application/json' },
  response: null,
  hit: false,
  timestamp: 0,
};

describe('generateCurl', () => {
  it('builds a single-line GET', () => {
    expect(generateCurl(base)).toBe(
      'curl --location --request GET "https://example.com/mcp" --header "Accept: application/json"'
    );
  });

  it('escapes quotes in headers and single quotes in the body', () => {
    const out = generateCurl({
      ...base,
      method: 'POST',
      requestHeaders: { 'X-Test': 'a"b' },
      requestBody: `{"n":"it's"}`,
    });
    expect(out).toContain('--header "X-Test: a\\"b"');
    expect(out).toContain(`--data '{"n":"it'\\''s"}'`);
    expect(out).not.toContain('\n');
  });
});
