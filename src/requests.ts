import { mkdir, readFile, rm, open, link } from 'node:fs/promises';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { atomicJson } from './config.js';
import { CliError, sanitize, usage } from './errors.js';
import type { Input, Settings } from './types.js';

export interface RequestRecord {
  version: 1; id: string; operation: string; fingerprint: string; identity: string;
  region: string; profile: string; createdAt: number; updatedAt: number;
  status: 'uploading' | 'submitting' | 'submitted' | 'uncertain' | 'rejected' | 'upload-failed';
  taskId?: number; result?: Input; error?: string;
}
interface Claim { version: 1; pid: number; token: string; initial: RequestRecord }
interface Attachment { version: 1; taskId: number; identity: string; attachedAt: number }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
export function requestName(id: string): string { if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) usage('requestId must contain 1–100 letters, digits, underscores or hyphens.'); return id; }
async function exclusiveFile(file: string, bytes: Buffer): Promise<boolean> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try { await link(temp, file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
  } finally { await rm(temp, { force: true }); }
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
export class RequestStore {
  constructor(private settings: Settings) {}
  private file(id: string) { return path.join(this.settings.home, 'requests', requestName(id) + '.json'); }
  private claimFile(id: string) { return path.join(this.settings.home, 'requests', '.claims', requestName(id) + '.json'); }
  private attachmentFile(id: string) { return path.join(this.settings.home, 'requests', '.attachments', requestName(id) + '.json'); }
  private async optionalJson<T>(file: string): Promise<T | null> {
    try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new CliError('E_REQUEST_RECORD', 'The local request record is invalid. Do not automatically resubmit.', 4);
    }
  }
  private async claim(id: string): Promise<Claim | null> {
    const c = await this.optionalJson<Claim>(this.claimFile(id));
    if (c && (c.version !== 1 || !Number.isSafeInteger(c.pid) || c.pid < 1 || !c.token || c.initial?.id !== id)) throw new CliError('E_REQUEST_RECORD', 'Invalid submission claim. Automatic resubmission is disabled.', 4, { requestId: id });
    return c;
  }
  async read(id: string): Promise<RequestRecord | null> {
    const c = await this.claim(id), stored = await this.optionalJson<RequestRecord>(this.file(id));
    let r = stored ?? c?.initial ?? null;
    if (r && (r.version !== 1 || r.id !== id || !['uploading', 'submitting', 'submitted', 'uncertain', 'rejected', 'upload-failed'].includes(r.status))) throw new CliError('E_REQUEST_RECORD', 'Invalid request state. Automatic resubmission is disabled.', 4, { requestId: id });
    if (!r) return null;
    if (['uploading', 'submitting'].includes(r.status) && (!c || !alive(c.pid))) r = { ...r, status: 'uncertain', error: 'The previous process ended without a confirmed result.' };
    const attachment = await this.optionalJson<Attachment>(this.attachmentFile(id));
    if (attachment) {
      if (attachment.version !== 1 || !Number.isSafeInteger(attachment.taskId) || attachment.taskId < 1 || attachment.identity !== r.identity) throw new CliError('E_REQUEST_RECORD', 'Invalid task attachment. Inspect local state.', 4, { requestId: id });
      r = { ...r, status: 'submitted', taskId: attachment.taskId }; delete r.error;
    }
    return r;
  }
  private async save(r: RequestRecord): Promise<void> { r.updatedAt = Date.now(); await atomicJson(this.file(r.id), r); }
  async identity(): Promise<string> {
    const file = path.join(this.settings.home, 'identity-salt');
    await exclusiveFile(file, randomBytes(32));
    const salt = await readFile(file);
    if (salt.length !== 32) throw new CliError('E_STATE', 'The CLI identity file is invalid. Preserve request records and inspect local state.', 4);
    return createHmac('sha256', salt).update(canonical({ key: this.settings.apiKey, region: this.settings.region, baseUrl: this.settings.baseUrl || '', profile: this.settings.profile })).digest('hex');
  }
  async submit(id: string, operation: string, input: unknown, action: (markSubmitting: () => Promise<void>) => Promise<{ taskId?: number; result?: Input }>): Promise<{ record: RequestRecord; reused: boolean }> {
    requestName(id);
    const identity = await this.identity(), fingerprint = createHash('sha256').update(canonical({ operation, input, identity })).digest('hex');
    const record: RequestRecord = { version: 1, id, operation, identity, fingerprint, region: this.settings.region, profile: this.settings.profile, createdAt: Date.now(), updatedAt: Date.now(), status: 'uploading' };
    // Claims are immutable and NEVER reclaimed. Recovery cannot open another submission window.
    // A complete claim is atomically linked, so SIGKILL cannot expose a partial owner file.
    const prior = await this.read(id);
    const won = !prior && await exclusiveFile(this.claimFile(id), Buffer.from(JSON.stringify({ version: 1, pid: process.pid, token: randomUUID(), initial: record } satisfies Claim)));
    if (!won) {
      const old = await this.read(id);
      if (!old) throw new CliError('E_UNCERTAIN', 'A submission claim exists without a readable record.', 4, { requestId: id });
      if (old.fingerprint !== fingerprint || old.identity !== identity) throw new CliError('E_REQUEST_CONFLICT', 'This request ID belongs to different input, defaults, region, or credentials.', 2, { requestId: id });
      if (old.status === 'submitted') return { record: old, reused: true };
      if (['uploading', 'submitting'].includes(old.status)) throw new CliError('E_REQUEST_IN_PROGRESS', 'This request is already being handled by another process.', 3, { requestId: id });
      if (old.status === 'uncertain') throw new CliError('E_UNCERTAIN', 'The previous submission result is unknown. Inspect or attach the existing official task; do not resubmit.', 4, { requestId: id });
      throw new CliError(old.status === 'rejected' ? 'E_PREVIOUS_REJECTED' : 'E_PREVIOUS_UPLOAD_FAILED', old.status === 'rejected' ? 'This request was rejected. Use a new ID for a deliberately new submission.' : 'The previous upload failed before generation. Inspect it and use a new ID for a deliberate retry.', old.status === 'rejected' ? 5 : 6, { requestId: id });
    }
    await this.save(record);
    try {
      const result = await action(async () => { record.status = 'submitting'; await this.save(record); });
      if (result.taskId !== undefined) record.taskId = result.taskId;
      if (result.result !== undefined) record.result = result.result;
      record.status = 'submitted'; await this.save(record);
      return { record, reused: false };
    } catch (error) {
      if (record.taskId !== undefined || record.result !== undefined) {
        // A successful official response remains a successful submission even if local I/O fails.
        record.status = 'submitted'; record.error = 'The official result was received, but saving the local record failed.';
        try { await this.save(record); } catch { /* Return the known task ID; the claim still prevents resubmission. */ }
        throw new CliError('E_STATE_SAVE', 'Official operation completed, but saving its local record failed. Continue with the returned task ID or inspect this request; do not create a replacement.', 4, { requestId: id, ...(record.taskId === undefined ? { officialResult: record.result } : { taskId: record.taskId }) });
      }
      const e = error instanceof CliError ? error : new CliError('E_NETWORK', error instanceof Error ? error.message : 'Request failed.', 6);
      const uncertain = record.status === 'submitting' && !['E_AUTH', 'E_REMOTE_REJECTED', 'E_RATE_LIMIT'].includes(e.code);
      record.status = uncertain ? 'uncertain' : record.status === 'submitting' ? 'rejected' : 'upload-failed';
      record.error = String(sanitize(e.message, this.settings.apiKey));
      try { await this.save(record); } catch { /* The immutable claim still forbids another create. */ }
      if (uncertain) throw new CliError('E_UNCERTAIN', 'The create result is unknown. Query the official task list before submitting again.', 4, { requestId: id, ...(record.taskId === undefined ? {} : { taskId: record.taskId }) });
      throw new CliError(e.code, e.message, e.exitCode, { ...e.details, requestId: id });
    }
  }
  async attach(id: string, taskId: number, verify: () => Promise<void>): Promise<RequestRecord> {
    const record = await this.read(id);
    if (!record) throw new CliError('E_NOT_FOUND', 'Local request record not found.', 2);
    const identity = await this.identity();
    if (record.identity !== identity || record.region !== this.settings.region || record.profile !== this.settings.profile) usage('The request belongs to another credential/profile/region.');
    if (record.taskId && record.taskId !== taskId) usage('This request already has a different official task.');
    if (['uploading', 'submitting'].includes(record.status)) throw new CliError('E_REQUEST_IN_PROGRESS', 'The original submission process is still running.', 3, { requestId: id });
    if (record.operation === 'asset.uploadFile' || ['rejected', 'upload-failed'].includes(record.status)) usage('This record cannot be attached to a Lux3D task.');
    await verify();
    const attached: Attachment = { version: 1, taskId, identity, attachedAt: Date.now() };
    await exclusiveFile(this.attachmentFile(id), Buffer.from(JSON.stringify(attached)));
    const current = await this.read(id);
    if (current?.taskId !== taskId) usage('Another official task was already attached to this request.');
    return current;
  }
}
export function publicRecord(r: RequestRecord): Input {
  const { identity: _identity, fingerprint: _fingerprint, ...value } = r;
  return value;
}
