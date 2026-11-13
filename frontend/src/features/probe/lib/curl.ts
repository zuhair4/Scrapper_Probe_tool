import type { AttemptLog } from './probeTypes';

export function generateCurl(attempt: AttemptLog): string {
  const parts: string[] = ['curl --location'];

  parts.push(`--request ${attempt.method}`);
  parts.push(`"${attempt.url}"`);

  for (const [key, value] of Object.entries(attempt.requestHeaders)) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    parts.push(`--header "${key}: ${escaped}"`);
  }

  if (attempt.requestBody) {
    const escaped = attempt.requestBody.replace(/'/g, `'\\''`);
    parts.push(`--data '${escaped}'`);
  }

  // Single line, Postman-importable
  return parts.join(' ');
}
