import type { CommandSpec, Flag } from './types.js';

const prompt: Flag[] = [{ flag: '--prompt <text>', description: 'Text prompt', field: 'prompt' }, { flag: '--prompt-file <file>', description: 'Read the UTF-8 prompt from a file' }];
const image: Flag[] = [{ flag: '--image <file>', description: 'Upload a local reference image' }, { flag: '--image-url <url>', description: 'Public HTTP(S) image URL', field: 'img' }];
const model: Flag[] = [{ flag: '--model <file>', description: 'Upload a local model' }, { flag: '--model-url <url>', description: 'Public HTTP(S) model URL' }];
const generation: Flag[] = [
  { flag: '--model-version <version>', description: 'Official generation version', field: 'version', choices: ['G1', 'G1-Turbo'] },
  { flag: '--face-count <number>', description: 'Target mesh faces, 10000–300000', field: 'faceCount', kind: 'number' },
  { flag: '--formats <formats>', description: 'Comma-separated requested formats', field: 'outputFormat', kind: 'list' },
  { flag: '--pbr <boolean>', description: 'Generate PBR mesh materials', field: 'enablePbr', kind: 'boolean' },
  { flag: '--predict-size <boolean>', description: 'Predict physical dimensions', field: 'aiPredictSize', kind: 'boolean' }
];
export const creationFlags: Flag[] = [
  { flag: '--request <file>', description: 'Official JSON body from a file, or - for stdin' },
  { flag: '--request-id <id>', description: 'Stable local submission identifier; reuse after interruption' }
];
export const globalFlags: Flag[] = [
  { flag: '--json', description: 'Output one versioned JSON result' },
  { flag: '--output <mode>', description: 'text or json', choices: ['text', 'json'] },
  { flag: '--home <directory>', description: 'Isolated CLI configuration and request directory' },
  { flag: '--profile <name>', description: 'CLI profile name' },
  { flag: '--region <region>', description: 'Official API region', choices: ['cn', 'com'] },
  { flag: '--base-url <url>', description: 'Override official gateway; loopback HTTP allowed for tests' },
  { flag: '--timeout <seconds>', description: 'Per-operation timeout (default 60)', kind: 'number' },
  { flag: '--poll-interval <seconds>', description: 'Query interval (default 12)', kind: 'number' },
  { flag: '--out-dir <directory>', description: 'Download root (default ./aholo-output)' },
  { flag: '--dry-run', description: 'Validate and describe the operation without network or state changes' },
  { flag: '--describe', description: 'Describe the selected command without credentials or network' },
  { flag: '--quiet', description: 'Suppress progress on stderr' },
  { flag: '--verbose', description: 'Print operation names on stderr, never credentials' }
];
const waitFlag: Flag = { flag: '--max-wait <seconds>', description: 'Total wait budget (default 600 seconds)', kind: 'number' };
const overwriteFlag: Flag = { flag: '--overwrite', description: 'Explicitly replace conflicting download files' };
const defaults = { version: 'G1-Turbo', faceCount: 50000, outputFormat: ['glb'], enablePbr: true, aiPredictSize: true };
const generationConditions = ['The CLI always sends an explicit version. G1 returns ZIP and GLB regardless of the requested mesh formats; requesting PLY adds PLY.', 'G1-Turbo defaults here to GLB; an explicitly empty outputFormat requests the official ZIP default.', 'faceCount does not affect PLY. enablePbr is effective only for G1-Turbo mesh output; the official service ignores it for G1 or PLY-only requests.'];
export const catalog: CommandSpec[] = [
  { path: ['asset', 'upload'], description: 'Upload a local file with the official Asset SDK', operationId: 'asset.uploadFile', kind: 'upload', argument: '<file>', flags: [{ flag: '--request-id <id>', description: 'Stable local upload request identifier' }] },
  { path: ['lux3d', 'image-to-3d'], description: 'Generate a 3D model from one image or multiple views', operationId: 'createImgTo3dTask', sdkMethod: 'imgTo3d', kind: 'create', defaults, flags: [...image, { flag: '--images <files...>', description: 'Ordered local multi-view images' }, { flag: '--image-urls <urls...>', description: 'Ordered public multi-view URLs', field: 'imgs' }, ...generation] },
  { path: ['lux3d', 'text-to-3d'], description: 'Generate a 3D model from text and an optional reference image', operationId: 'createTextTo3dTask', sdkMethod: 'textTo3d', kind: 'create', defaults: { ...defaults, style: 'photorealistic' }, flags: [...prompt, ...image, { flag: '--style <style>', description: 'Official text-to-3D style', field: 'style' }, ...generation] },
  { path: ['lux3d', 'image'], description: 'Official multimodal image generation', operationId: 'createMultimodalToImageTask', sdkMethod: 'multimodalToImage', kind: 'create', flags: [...prompt, ...image] },
  { path: ['lux3d', 'four-view'], description: 'Generate four standard views from an image and/or prompt', operationId: 'createImageToFourViewTask', sdkMethod: 'imageToFourView', kind: 'create', flags: [...prompt, ...image] },
  { path: ['lux3d', 'material-transfer'], description: 'Transfer reference-image materials to an existing model', operationId: 'createMaterialTransferTask', sdkMethod: 'materialTransfer', kind: 'create', defaults: { version: 'v3.0-standard' }, flags: [...model, ...image, { flag: '--formats <formats>', description: 'Requested official material output formats', field: 'outputFormat', kind: 'list' }, { flag: '--predict-size <boolean>', description: 'Predict model size', field: 'aiPredictSize', kind: 'boolean' }, { flag: '--custom-size <number>', description: 'Model height in millimetres', field: 'customSize', kind: 'number' }] },
  { path: ['lux3d', 'export'], description: 'Export a GLB or official Lux3D ZIP to other formats', operationId: 'createMultiFormatExportTask', sdkMethod: 'multiFormatExport', kind: 'create', flags: [...model, { flag: '--formats <formats>', description: 'usdz,obj_zip,fbx_zip,stl,3mf', field: 'outputFormat', kind: 'list' }] },
  { path: ['lux3d', 'split'], description: 'Split an existing model using the official API', operationId: 'createPartSplitTask', sdkMethod: 'partSplit', kind: 'create', flags: model },
  { path: ['lux3d', 'articulate'], description: 'Official articulation and animation generation', operationId: 'createArticulationAnimationTask', sdkMethod: 'articulationAnimation', kind: 'create', flags: [...model, ...prompt] },
  { path: ['lux3d', 'rig'], description: 'Official humanoid automatic rigging', operationId: 'createHumanoidAutoRigTask', sdkMethod: 'humanoidAutoRig', kind: 'create', flags: model },
  { path: ['lux3d', 'retarget'], description: 'Apply official preset animations to a rigged model', operationId: 'createHumanoidAnimationRetargetTask', sdkMethod: 'humanoidAnimationRetarget', kind: 'create', flags: [...model, { flag: '--animations <ids>', description: 'Comma-separated official animation IDs', field: 'animationIds', kind: 'list' }, { flag: '--animation-output-mode <mode>', description: 'Separate files or combined clips', field: 'animationOutputMode', choices: ['separate', 'combined'] }, { flag: '--out-format <format>', description: 'Animation file format', field: 'outFormat', choices: ['glb', 'fbx'] }, { flag: '--in-place <boolean>', description: 'Generate animation in place', field: 'animateInPlace', kind: 'boolean' }] },
  { path: ['lux3d', 'task', 'get'], description: 'Get official task details', operationId: 'getTask', kind: 'get', argument: '<taskId>' },
  { path: ['lux3d', 'task', 'list'], description: 'List official Lux3D tasks', operationId: 'listTasks', kind: 'list', flags: [{ flag: '--page <number>', description: 'Page number', field: 'page', kind: 'number' }, { flag: '--page-size <number>', description: 'Items per page, 1–100', field: 'pagesize', kind: 'number' }, { flag: '--status <number>', description: 'Filter status: 0,1,3,4', field: 'status', kind: 'number' }, { flag: '--start-time <ms>', description: 'Inclusive Unix millisecond creation time', field: 'starttime', kind: 'number' }, { flag: '--end-time <ms>', description: 'Exclusive Unix millisecond creation time', field: 'endtime', kind: 'number' }] },
  { path: ['lux3d', 'task', 'wait'], description: 'Wait for an existing task without submitting another', operationId: 'getTask', kind: 'wait', argument: '<taskId>' },
  { path: ['lux3d', 'task', 'download'], description: 'Download all available outputs of an existing task', operationId: 'getTask', kind: 'download', argument: '<taskId>' },
  { path: ['request', 'get'], description: 'Inspect a local submission record', operationId: 'local.request.get', kind: 'support', argument: '<requestId>' },
  { path: ['request', 'attach'], description: 'Attach a verified existing official task to an uncertain local request', operationId: 'local.request.attach', kind: 'support', argument: '<requestId>', flags: [{ flag: '--task-id <number>', description: 'Existing official task ID', kind: 'number' }] },
  { path: ['config', 'show'], description: 'Show the selected profile without exposing credentials', operationId: 'local.config.show', kind: 'support' },
  { path: ['config', 'set'], description: 'Save an isolated CLI profile', operationId: 'local.config.set', kind: 'support', flags: [{ flag: '--api-key-stdin', description: 'Read a key from stdin and save it in the private profile' }] },
  { path: ['config', 'list'], description: 'List CLI profile names', operationId: 'local.config.list', kind: 'support' },
  { path: ['doctor'], description: 'Check the local CLI environment without calling an account API', operationId: 'local.doctor', kind: 'support' },
  { path: ['capabilities'], description: 'List commands, contracts, and verification levels', operationId: 'local.capabilities', kind: 'support' },
  { path: ['skill', 'export'], description: 'Export the version-matched Skill to a chosen directory', operationId: 'local.skill.export', kind: 'support', argument: '<directory>' }
];
for (const spec of catalog) {
  if (spec.sdkMethod === 'imgTo3d') spec.conditions = ['Exactly one of img or imgs is required. imgs preserves 1–32 input views in order.', ...generationConditions];
  if (spec.sdkMethod === 'textTo3d') spec.conditions = generationConditions;
  if (['multimodalToImage', 'imageToFourView'].includes(spec.sdkMethod || '')) spec.conditions = ['At least one of img or prompt is required.'];
  if (spec.sdkMethod === 'materialTransfer') spec.conditions = ['version is fixed to v3.0-standard.', 'aiPredictSize=true makes the official service ignore customSize. With false/omitted, customSize is the target height in millimetres.'];
  if (spec.sdkMethod === 'multiFormatExport') spec.conditions = ['GLB input requires at least one outputFormat; ZIP may omit formats. ZIP must be an official Lux3D result; the CLI cannot prove provenance from bytes alone.'];
  if (['humanoidAutoRig', 'humanoidAnimationRetarget'].includes(spec.sdkMethod || '')) spec.conditions = ['The official model URL must use HTTPS. Local GLB files are uploaded through the official Asset SDK.'];
}

export function modelField(spec: CommandSpec): string {
  return spec.sdkMethod === 'materialTransfer' ? 'meshUrl' : ['partSplit', 'articulationAnimation'].includes(spec.sdkMethod || '') ? 'glbUrl' : spec.sdkMethod === 'humanoidAnimationRetarget' ? 'rigModelUrl' : 'modelUrl';
}
export function flagsFor(spec: CommandSpec): readonly Flag[] {
  return [...(spec.flags || []), ...(spec.kind === 'create' ? [...creationFlags, { flag: '--wait', description: 'Wait for the created or recovered task' }, { flag: '--download', description: 'Wait and save all task outputs' }, waitFlag, overwriteFlag] : spec.kind === 'wait' ? [waitFlag] : spec.kind === 'download' ? [overwriteFlag] : [])];
}
export function optionKey(flag: string): string { return flag.split(' ')[0]!.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()); }
