import type { Input } from './types.js';

export class CliError extends Error {
  constructor(public code: string, message: string, public exitCode = 1, public details: Input = {}) { super(message); }
}
export function usage(message: string): never { throw new CliError('E_ARGUMENT', message, 2); }
export function networkError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  const obj = error as { name?: string; cmdCode?: unknown; statusCode?: unknown; body?: unknown; message?: unknown };
  if (obj?.name === 'BusinessError' && typeof obj.cmdCode === 'string' && obj.cmdCode.trim() && obj.cmdCode !== '0') return new CliError('E_REMOTE_REJECTED', String(obj.message || 'Official API rejected the request.'), 5, { remoteCode: obj.cmdCode, official: obj.body });
  if (obj?.name === 'AuthenticationError' || obj?.statusCode === 401 || obj?.statusCode === 403) return new CliError('E_AUTH', 'Official API authentication failed. Check the selected region and API key.', 6);
  if (obj?.name === 'RateLimitError' || obj?.statusCode === 429) return new CliError('E_RATE_LIMIT', 'Official API rate limit reached; retry the existing query later.', 6);
  return new CliError('E_NETWORK', obj?.message ? String(obj.message) : 'The request failed.', 6);
}
export function sanitize(value: unknown, secret = ''): unknown {
  if (typeof value === 'string') {
    let text = secret ? value.replaceAll(secret, '[REDACTED]') : value;
    return text.replace(/https?:\/\/[^\s"<>]+/g, url => {
      try { const u = new URL(url); return u.search ? `${u.origin}${u.pathname}?[REDACTED]` : url; } catch { return '[URL]'; }
    });
  }
  if (Array.isArray(value)) return value.map(v => sanitize(v, secret));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, /^(apiKey|authorization|ousToken|accessToken|password|secret)$/i.test(key) ? '[REDACTED]' : sanitize(v, secret)]));
  return value;
}
