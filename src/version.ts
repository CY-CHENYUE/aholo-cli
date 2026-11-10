import { readFileSync } from 'node:fs';
export const packageInfo = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string; version: string; dependencies: Record<string, string> };
export const VERSION = packageInfo.version;
