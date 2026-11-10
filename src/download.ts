import { mkdir, open, readFile, rename, rm, link } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { atomicJson } from './config.js';
import { publicUrl } from './contracts.js';
import { CliError, sanitize } from './errors.js';
import { assertCompleted } from './tasks.js';
import type { ApiPort, Input, TaskResult } from './types.js';

interface Output { key: string; url: string }
interface Saved { key: string; path: string; bytes: number; sha256: string }
export function extractOutputs(task: TaskResult): { files: Output[]; metadata: unknown[] } {
  const files: Output[] = [], metadata: unknown[] = [];
  function walk(value: unknown, key: string, depth = 0): void {
    if (depth > 15 || files.length > 512) throw new CliError('E_OUTPUT', 'Official output nesting or file count exceeds the CLI limit.', 6);
    if (typeof value === 'string') {
      if (value === 'NOT_REQUESTED' || !value.trim()) return;
      if (/^https?:\/\//i.test(value)) { publicUrl(value, 'Output'); files.push({ key, url: value }); return; }
      try { const parsed: unknown = JSON.parse(value); if (parsed !== value) { walk(parsed, key, depth + 1); return; } } catch (error) { if (error instanceof CliError) throw error; }
      metadata.push({ key, value });
    } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${key}.${i}`, depth + 1));
    else if (value && typeof value === 'object') {
      // Failed action payloads are retained even if other actions have downloadable files.
      const obj = value as Input;
      if (obj.error !== undefined || obj.status === 'failed') { metadata.push({ key, value }); return; }
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string' && !/^https?:\/\//i.test(v) && !/^[\[{]/.test(v)) continue;
        walk(v, `${key}.${k}`, depth + 1);
      }
    }
  }
  (task.outputs || []).forEach((o, i) => walk(o.content, `outputs.${i}`));
  return { files, metadata };
}
export function validateFile(bytes: Buffer, ext: string, size: number): void {
  const text = bytes.toString('ascii', 0, 100).trimStart().toLowerCase();
  if (!size || text.startsWith('<!doctype html') || text.startsWith('<html')) throw new CliError('E_DOWNLOAD_FORMAT', 'Downloaded content is empty or an HTML error page.', 6);
  let valid = true;
  if (ext === '.glb') valid = size >= 20 && bytes.toString('ascii', 0, 4) === 'glTF' && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === size;
  else if (['.zip', '.usdz', '.3mf'].includes(ext)) valid = bytes[0] === 80 && bytes[1] === 75 && [3, 5, 7].includes(bytes[2]!);
  else if (ext === '.png') valid = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  else if (['.jpg', '.jpeg'].includes(ext)) valid = bytes[0] === 255 && bytes[1] === 216;
  else if (ext === '.webp') valid = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  else if (ext === '.ply') valid = /^ply[\r\n]/.test(bytes.toString('ascii', 0, 5));
  else if (ext === '.fbx') valid = bytes.toString('ascii', 0, 18) === 'Kaydara FBX Binary ' || /^;\s*FBX/.test(bytes.toString('ascii', 0, 40));
  else if (ext === '.stl') valid = bytes.toString('ascii', 0, 6).trimStart().startsWith('solid') || (bytes.length >= 84 && size === 84 + bytes.readUInt32LE(80) * 50);
  if (!valid) throw new CliError('E_DOWNLOAD_FORMAT', `Downloaded content does not match ${ext}.`, 6);
}
class DownloadHttpError extends Error { constructor(public status: number) { super(`Download HTTP ${status}`); } }
export async function downloadTask(api: ApiPort, task: TaskResult, options: { outDir: string; timeout: number; overwrite: boolean; fetch: typeof fetch; signal?: AbortSignal }): Promise<Input> {
  assertCompleted(task);
  const directory = path.join(options.outDir, `task-${task.taskId}`);
  const manifestPath = path.join(directory, 'files.json');
  await mkdir(directory, { recursive: true });
  let manifest: { version: 1; taskId: number; files: Saved[] } = { version: 1, taskId: task.taskId, files: [] };
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as typeof manifest;
    if (manifest.version !== 1 || manifest.taskId !== task.taskId || !Array.isArray(manifest.files)) throw Error('Invalid manifest');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CliError('E_DOWNLOAD_MANIFEST', 'Existing files.json is invalid. Choose a new output directory.', 2); }
  const extracted = extractOutputs(task);
  if (!extracted.files.length) throw new CliError('E_NO_FILES', 'The task has no downloadable output files.', 5, { taskId: task.taskId, official: task, metadata: extracted.metadata });
  const complete: Input[] = [], failed: Input[] = [];
  let refreshed = false;
  for (let i = 0; i < extracted.files.length; i++) {
    options.signal?.throwIfAborted();
    let item = extracted.files[i]!;
    const raw = path.posix.basename(new URL(item.url).pathname);
    const name = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'output.bin';
    const final = path.join(directory, `${String(i + 1).padStart(2, '0')}-${name}`);
    const ext = path.extname(name).toLowerCase();
    const temp = `${final}.${randomUUID()}.part`;
    try {
      try {
        const existing = await readFile(final);
        const saved = manifest.files.find(f => f.key === item.key && f.path === final);
        if (saved && saved.bytes === existing.length && saved.sha256 === createHash('sha256').update(existing).digest('hex')) {
          complete.push({ ...saved, reused: true }); continue;
        }
        if (!options.overwrite) throw new CliError('E_FILE_EXISTS', `Existing file differs or is not recorded: ${final}. Choose another --out-dir or explicitly --overwrite.`, 2);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      let saved: Saved | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const signal = AbortSignal.timeout(Math.ceil(options.timeout * 1000));
          // Only the result URL is sent to this fetch. Never forward the API key or gateway headers.
          const response = await options.fetch(item.url, { signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal });
          if (!response.ok) { await response.body?.cancel(); throw new DownloadHttpError(response.status); }
          if (!response.body) throw Error('Download has no response body');
          const length = response.headers.get('content-encoding') ? null : response.headers.get('content-length');
          const handle = await open(temp, 'wx', 0o600);
          let bytes = 0, head = Buffer.alloc(0);
          const hash = createHash('sha256');
          try {
            for await (const chunk of response.body) {
              const buffer = Buffer.from(chunk); bytes += buffer.length;
              if (bytes > 2 * 1024 ** 3) throw new CliError('E_DOWNLOAD_SIZE', 'An output exceeds the CLI 2 GiB limit.', 6);
              if (head.length < 256) head = Buffer.concat([head, buffer]).subarray(0, 256);
              hash.update(buffer); await handle.writeFile(buffer);
            }
            if (length !== null && Number(length) !== bytes) throw new CliError('E_DOWNLOAD_SIZE', 'Downloaded size differs from Content-Length.', 6);
            validateFile(head, ext, bytes);
            await handle.sync();
          } finally { await handle.close(); }
          if (options.overwrite) await rename(temp, final);
          else { await link(temp, final); await rm(temp); }
          saved = { key: item.key, path: final, bytes, sha256: hash.digest('hex') }; break;
        } catch (error) {
          await rm(temp, { force: true });
          options.signal?.throwIfAborted();
          if (error instanceof DownloadHttpError && [401, 403, 404].includes(error.status) && !refreshed) {
            const newer = await api.get(task.taskId, options.timeout * 1000); assertCompleted(newer); refreshed = true;
            const replacements = new Map(extractOutputs(newer).files.map(f => [f.key, f]));
            for (let j = i + 1; j < extracted.files.length; j++) extracted.files[j] = replacements.get(extracted.files[j]!.key) || extracted.files[j]!;
            const replacement = replacements.get(item.key);
            if (replacement) { item = replacement; continue; }
          }
          if (error instanceof CliError || (error instanceof DownloadHttpError && error.status < 500 && error.status !== 429) || attempt === 2) throw error;
        }
      }
      if (!saved) throw Error('Download attempts exhausted');
      manifest.files = [...manifest.files.filter(f => f.key !== saved!.key), saved];
      await atomicJson(manifestPath, manifest); complete.push({ ...saved, reused: false });
    } catch (error) {
      options.signal?.throwIfAborted();
      failed.push({ key: item.key, path: final, code: error instanceof CliError ? error.code : 'E_DOWNLOAD', message: sanitize(error instanceof Error ? error.message : 'Download failed.') });
    } finally { await rm(temp, { force: true }); }
  }
  const result = { taskId: task.taskId, directory, files: complete, failures: failed, metadata: extracted.metadata };
  if (failed.length) throw new CliError('E_DOWNLOAD', 'Some outputs could not be saved. Completed files are retained; rerun download for the same task.', 6, result);
  if (extracted.metadata.some(v => JSON.stringify(v).includes('"error"') || JSON.stringify(v).includes('"failed"'))) throw new CliError('E_PARTIAL_OUTPUT', 'Official output contains failed actions. Available files were saved.', 5, result);
  return result;
}
