export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Input = Record<string, unknown>;
export interface IO { out(text: string): void; err(text: string): void; input(): Promise<string> }
export interface Settings {
  home: string; profile: string; region: 'cn' | 'com'; apiKey: string;
  baseUrl?: string; timeout: number; pollInterval: number; outDir: string;
}
export interface LocalFile { path: string; field: string; index?: number; bytes: Buffer; sha256: string }
export interface Prepared { body: Input; files: LocalFile[]; identity: Input }
export interface TaskOutput { type?: string; content?: string; [key: string]: unknown }
export interface TaskResult { taskId: number; status: number; outputs?: TaskOutput[]; [key: string]: unknown }
export interface ApiPort {
  upload(bytes: Buffer, filename: string, timeoutMs: number): Promise<{ url: string; [key: string]: unknown }>;
  create(operationId: string, body: Input, timeoutMs: number): Promise<number>;
  get(taskId: number, timeoutMs: number): Promise<TaskResult>;
  list(body: Input, timeoutMs: number): Promise<unknown>;
}
export interface Dependencies {
  io?: IO; env?: NodeJS.ProcessEnv;
  client?: (settings: Settings) => ApiPort;
  fetch?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>;
}
export interface Result { service: string; operation: string; data: unknown; local?: Input }
export interface Flag {
  flag: string; description: string; field?: string;
  kind?: 'number' | 'boolean' | 'list'; choices?: readonly string[];
}
export interface CommandSpec {
  path: readonly string[]; description: string; operationId: string;
  sdkMethod?: string; kind: 'create' | 'get' | 'list' | 'wait' | 'download' | 'upload' | 'support';
  flags?: readonly Flag[]; argument?: string; defaults?: Input;
  conditions?: readonly string[];
}
