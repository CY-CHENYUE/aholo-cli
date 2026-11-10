import { readFileSync } from 'node:fs';
import { Ajv, type ValidateFunction } from 'ajv';
import { usage } from './errors.js';
import type { Input } from './types.js';

export interface Contract { path: string; method: string; schema: Input }
export const contracts = JSON.parse(readFileSync(new URL('../schemas/contracts.json', import.meta.url), 'utf8')) as { source: string; sourceSha256: string; specVersion: string; operations: Record<string, Contract> };
export const assetContracts = JSON.parse(readFileSync(new URL('../schemas/asset-contracts.json', import.meta.url), 'utf8')) as { source: string; sourceSha256: string; specVersion: string; uploadStates: Input; operations: Record<string, Input> };
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: true, logger: false });
ajv.addFormat('uri', { type: 'string', validate: (text: string) => { try { const u = new URL(text); return ['http:', 'https:'].includes(u.protocol); } catch { return false; } } });
const validators = new Map<string, ValidateFunction>();
export function validateBody(operation: string, body: Input): void {
  const contract = contracts.operations[operation];
  if (!contract) usage(`Unknown official operation: ${operation}`);
  let validate = validators.get(operation);
  if (!validate) { validate = ajv.compile(contract.schema); validators.set(operation, validate); }
  if (!validate(body)) usage(`Invalid official request: ${ajv.errorsText(validate.errors, { separator: '; ', dataVar: 'request' })}`);
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string' && ['img', 'glbUrl', 'meshUrl', 'modelUrl', 'rigModelUrl'].includes(key)) publicUrl(value, key);
    if (key === 'imgs' && Array.isArray(value)) value.forEach(v => publicUrl(String(v), 'imgs'));
  }
  if (operation === 'createImgTo3dTask' && (body.img !== undefined) === (body.imgs !== undefined)) usage('Provide exactly one single image or an ordered multi-view image list.');
  if (['createMultimodalToImageTask', 'createImageToFourViewTask'].includes(operation) && body.img === undefined && body.prompt === undefined) usage('Provide an image and/or a non-empty prompt.');
  if (operation === 'createMultiFormatExportTask') {
    const isZip = typeof body.modelUrl === 'string' && new URL(body.modelUrl).pathname.toLowerCase().endsWith('.zip');
    if (!isZip && (!Array.isArray(body.outputFormat) || body.outputFormat.length === 0)) usage('GLB export requires at least one --formats value.');
  }
  if (operation === 'listTasks' && body.starttime !== undefined && body.endtime !== undefined && Number(body.starttime) >= Number(body.endtime)) usage('--start-time must precede --end-time.');
  if (['createHumanoidAutoRigTask', 'createHumanoidAnimationRetargetTask'].includes(operation)) {
    const value = body.modelUrl ?? body.rigModelUrl;
    if (typeof value === 'string' && new URL(value).protocol !== 'https:') usage('The official rigging/retargeting model URL must use HTTPS.');
  }
}
export function publicUrl(value: string, label: string): void {
  try { const u = new URL(value); if (['http:', 'https:'].includes(u.protocol) && !u.username && !u.password) return; } catch { /* usage below */ }
  usage(`${label} must be an HTTP(S) URL without embedded credentials.`);
}
export function taskId(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) usage('taskId must be a positive safe integer.');
  return n;
}
