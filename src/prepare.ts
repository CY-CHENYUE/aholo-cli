import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { flagsFor, modelField, optionKey } from './catalog.js';
import { validateBody, publicUrl } from './contracts.js';
import { CliError, usage } from './errors.js';
import type { CommandSpec, Input, IO, LocalFile, Prepared } from './types.js';

const MAX_FILE = 256 * 1024 * 1024;
export async function localFile(filename: string, field: string, index?: number): Promise<LocalFile> {
  const file = path.resolve(filename);
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size < 1 || info.size > MAX_FILE) usage('Each local file must be non-empty and at most 256 MiB.');
    const bytes = await readFile(file);
    if (bytes.length > MAX_FILE) usage('A local input file exceeds 256 MiB.');
    return { path: file, field, ...(index === undefined ? {} : { index }), bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('E_FILE', `Cannot read local input: ${file}`, 2);
  }
}
function set(body: Input, field: string, value: unknown): void {
  if (Object.hasOwn(body, field)) usage(`Request field ${field} was provided more than once.`);
  body[field] = value;
}
export async function prepare(spec: CommandSpec, opts: Input, io: IO): Promise<Prepared> {
  let body: Input = {};
  if (opts.request !== undefined) {
    let text: string;
    try { text = opts.request === '-' ? await io.input() : await readFile(String(opts.request), 'utf8'); } catch { usage('Cannot read --request JSON.'); }
    if (Buffer.byteLength(text) > 1024 * 1024) usage('--request is limited to 1 MiB.');
    try { const v: unknown = JSON.parse(text); if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error(); body = v as Input; } catch { usage('--request must contain one JSON object.'); }
  }
  for (const f of flagsFor(spec)) if (f.field && opts[optionKey(f.flag)] !== undefined) set(body, f.field, opts[optionKey(f.flag)]);
  if (opts.promptFile !== undefined) {
    let text: string; try { text = await readFile(String(opts.promptFile), 'utf8'); } catch { usage('Cannot read --prompt-file.'); }
    if (!text.trim() || Buffer.byteLength(text) > 1024 * 1024) usage('Prompt files must be non-empty UTF-8 text, at most 1 MiB.');
    set(body, 'prompt', text.trim());
  }
  const files: LocalFile[] = [];
  if (opts.image !== undefined) files.push(await localFile(String(opts.image), 'img'));
  if (opts.images !== undefined) {
    const names = opts.images as string[];
    if (names.length < 1 || names.length > 32) usage('--images requires 1–32 images.');
    for (let i = 0; i < names.length; i++) files.push(await localFile(names[i]!, 'imgs', i));
  }
  if (opts.model !== undefined) files.push(await localFile(String(opts.model), modelField(spec)));
  if (opts.modelUrl !== undefined) set(body, modelField(spec), opts.modelUrl);
  if (files.reduce((n, f) => n + f.bytes.length, 0) > 512 * 1024 * 1024) usage('Total local inputs exceed the CLI limit of 512 MiB.');
  for (const file of files) {
    if (file.field === 'img' || file.field === 'imgs') {
      const b = file.bytes;
      if (!(b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || (b[0] === 255 && b[1] === 216) || (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'))) usage(`Expected a PNG, JPEG, or WebP image: ${file.path}`);
    } else {
      const ext = path.extname(file.path).toLowerCase(), b = file.bytes;
      const glb = ext === '.glb' && b.length >= 20 && b.toString('ascii', 0, 4) === 'glTF' && b.readUInt32LE(4) === 2 && b.readUInt32LE(8) === b.length;
      const zip = spec.sdkMethod === 'multiFormatExport' && ext === '.zip' && b[0] === 80 && b[1] === 75;
      if (!glb && !zip) usage('Local model must be a valid GLB; multi-format export also accepts official Lux3D ZIP files.');
    }
  }
  const groups = new Set(files.map(f => f.field));
  for (const field of groups) {
    const matches = files.filter(f => f.field === field);
    const urls = matches.map(f => `https://local.invalid/${f.sha256}${path.extname(f.path)}`);
    set(body, field, field === 'imgs' ? urls : urls[0]);
  }
  body = { ...(spec.defaults || {}), ...body };
  validateBody(spec.operationId, body);
  // The placeholder URLs carry content hashes; identities never depend on mutable file paths.
  const identity = structuredClone(body);
  return { body, files, identity };
}
export async function uploadInputs(prepared: Prepared, upload: (file: LocalFile) => Promise<string>): Promise<Input> {
  const body = structuredClone(prepared.body);
  for (const file of prepared.files) {
    const url = await upload(file); publicUrl(url, 'Uploaded file');
    if (file.index === undefined) body[file.field] = url;
    else (body[file.field] as string[])[file.index] = url;
  }
  return body;
}
