import { readFile, mkdir, rename, open, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Input, Settings } from './types.js';
import { CliError, usage } from './errors.js';

export interface Profile { region?: 'cn' | 'com'; apiKey?: string; baseUrl?: string; outDir?: string; timeout?: number; pollInterval?: number }
export interface ConfigFile { version: 1; profiles: Record<string, Profile> }
function validProfile(name: string): boolean { return /^[a-zA-Z0-9_-]{1,64}$/.test(name) && !['__proto__', 'constructor', 'prototype'].includes(name); }
export async function atomicJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(data, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, file);
  } finally { await rm(temp, { force: true }); }
}
export async function readConfig(home: string): Promise<ConfigFile> {
  try {
    const v = JSON.parse(await readFile(path.join(home, 'config.json'), 'utf8')) as ConfigFile;
    if (v.version !== 1 || !v.profiles || typeof v.profiles !== 'object' || Array.isArray(v.profiles)) throw Error('Unsupported config structure');
    for (const [name, profile] of Object.entries(v.profiles)) {
      if (!validProfile(name) || !profile || typeof profile !== 'object' || Array.isArray(profile)) throw Error('Invalid profile');
      for (const [key, value] of Object.entries(profile)) {
        if (['apiKey', 'baseUrl', 'outDir'].includes(key)) { if (typeof value !== 'string') throw Error('Expected string'); }
        else if (key === 'region') { if (!['cn', 'com'].includes(String(value))) throw Error('Invalid region'); }
        else if (['timeout', 'pollInterval'].includes(key)) { if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 86400) throw Error('Invalid timeout'); }
        else throw Error('Unknown profile field');
      }
    }
    return v;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, profiles: {} };
    throw new CliError('E_CONFIG', 'The CLI config is invalid; fix or select another --home directory.', 2);
  }
}
function positive(value: unknown, fallback: number, label: string): number {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 86400) usage(`${label} must be greater than 0 and at most 86400 seconds.`);
  return n;
}
export async function settingsFor(options: Input, env: NodeJS.ProcessEnv): Promise<Settings> {
  const home = path.resolve(String(options.home ?? env.AHOLO_CLI_HOME ?? path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'aholo-cli')));
  const profile = String(options.profile ?? env.AHOLO_PROFILE ?? 'default');
  if (!validProfile(profile)) usage('Profile names require 1–64 letters, digits, underscores or hyphens and must not use a reserved object property name.');
  const config = await readConfig(home), p = config.profiles[profile] || {};
  const region = options.region ?? env.AHOLO_REGION ?? p.region ?? 'cn';
  if (region !== 'cn' && region !== 'com') usage('--region must be cn or com.');
  const baseUrl = options.baseUrl ?? env.AHOLO_BASE_URL ?? p.baseUrl;
  if (baseUrl !== undefined) {
    let u: URL; try { u = new URL(String(baseUrl)); } catch { usage('--base-url must be a valid URL.'); }
    if (u.username || u.password || u.search || u.hash || !(u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))) usage('--base-url requires HTTPS, or HTTP on loopback for local tests, without credentials/query/fragment.');
  }
  const apiKey = String(env.AHOLO_API_KEY ?? p.apiKey ?? '').trim();
  return { home, profile, region, apiKey, ...(baseUrl === undefined ? {} : { baseUrl: String(baseUrl).replace(/\/$/, '') }), timeout: positive(options.timeout ?? env.AHOLO_TIMEOUT ?? p.timeout, 60, 'timeout'), pollInterval: positive(options.pollInterval ?? env.AHOLO_POLL_INTERVAL ?? p.pollInterval, 12, 'poll interval'), outDir: path.resolve(String(options.outDir ?? env.AHOLO_OUTPUT_DIR ?? p.outDir ?? './aholo-output')) };
}
export function requireKey(settings: Settings): void {
  if (!settings.apiKey) throw new CliError('E_AUTH', 'Set AHOLO_API_KEY or save a key using config set --api-key-stdin. No request was sent.', 6);
}
export function publicSettings(s: Settings): Input { return { home: s.home, profile: s.profile, region: s.region, baseUrl: s.baseUrl ?? (s.region === 'cn' ? 'https://api.aholo3d.cn' : 'https://api.aholo.ai'), apiKeyConfigured: !!s.apiKey, timeout: s.timeout, pollInterval: s.pollInterval, outDir: s.outDir }; }
