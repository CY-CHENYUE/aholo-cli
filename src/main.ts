import { Command, CommanderError, Option } from 'commander';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog, flagsFor, globalFlags, optionKey } from './catalog.js';
import { atomicJson, publicSettings, readConfig, requireKey, settingsFor, type Profile } from './config.js';
import { contracts, publicUrl, taskId, validateBody } from './contracts.js';
import { officialClient } from './clients.js';
import { describe } from './describe.js';
import { downloadTask } from './download.js';
import { CliError, sanitize, usage } from './errors.js';
import { localFile, prepare, uploadInputs } from './prepare.js';
import { RequestStore, publicRecord, requestName } from './requests.js';
import { waitTask } from './tasks.js';
import { VERSION } from './version.js';
import type { CommandSpec, Dependencies, Flag, Input, IO, Result } from './types.js';

function flagOption(f: Flag): Option {
  const option = new Option(f.flag, f.description);
  if (f.choices) option.choices([...f.choices]);
  else if (f.kind) option.argParser((value: string) => {
    if (f.kind === 'number') { const n = Number(value); if (!Number.isFinite(n) || !value.trim()) usage(`${f.flag.split(' ')[0]} requires a number.`); return n; }
    if (f.kind === 'boolean') { if (!['true', 'false'].includes(value)) usage(`${f.flag.split(' ')[0]} requires true or false.`); return value === 'true'; }
    const values = value.split(',').map(s => s.trim()); if (values.some(s => !s)) usage(`${f.flag.split(' ')[0]} requires comma-separated non-empty values.`); return values;
  });
  return option;
}
function preflight(args: string[]): { json: boolean; describe: boolean } {
  const flags = [...globalFlags, ...catalog.flatMap(flagsFor)];
  let json = false, describe = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!; if (arg === '--') break;
    const [name, inline] = arg.split('=', 2);
    if (name === '--json') json = true;
    if (name === '--describe') describe = true;
    const f = flags.find(f => f.flag.split(' ')[0] === name);
    if (f?.flag.includes('<') && inline === undefined && !f.flag.includes('...')) {
      const value = args[++i]; if (name === '--output' && value === 'json') json = true;
    } else if (name === '--output' && inline === 'json') json = true;
  }
  return { json, describe };
}
function redactCredentials(value: unknown, key: string): unknown {
  if (typeof value === 'string') return key ? value.replaceAll(key, '[REDACTED]') : value;
  if (Array.isArray(value)) return value.map(v => redactCredentials(v, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /^(apiKey|authorization|ousToken|accessToken|password|secret)$/i.test(k) ? '[REDACTED]' : redactCredentials(v, key)]));
  return value;
}
async function stdin(signal: AbortSignal): Promise<string> {
  const chunks: Buffer[] = []; let size = 0;
  signal.throwIfAborted();
  const abort = () => process.stdin.destroy(signal.reason as Error);
  signal.addEventListener('abort', abort, { once: true });
  try {
    for await (const part of process.stdin) { const b = Buffer.from(part); size += b.length; if (size > 1024 * 1024) usage('stdin exceeds 1 MiB.'); chunks.push(b); }
    return Buffer.concat(chunks).toString('utf8');
  } finally { signal.removeEventListener('abort', abort); }
}
function maxWait(opts: Input): number {
  const n = Number(opts.maxWait ?? 600); if (!Number.isFinite(n) || n <= 0 || n > 86400) usage('--max-wait must be greater than 0 and at most 86400 seconds.'); return n;
}
export async function runCli(args: string[], dependencies: Dependencies = {}): Promise<number> {
  const io: IO = dependencies.io || { out: text => process.stdout.write(text), err: text => process.stderr.write(text), input: () => stdin(controller.signal) };
  const env = dependencies.env ?? process.env;
  const before = preflight(args); let json = before.json, secret = '', chosen: Command | undefined, parserText = '', result: Result | undefined;
  let activeRequest: string | undefined, activeTask: number | undefined;
  const controller = new AbortController();
  const interrupt = () => controller.abort(new CliError('E_INTERRUPTED', 'Local operation interrupted. Continue the existing task or inspect the request record.', 130));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const now = dependencies.now || Date.now;
  const sleep = dependencies.sleep || ((ms: number) => new Promise<void>((resolve, reject) => {
    if (controller.signal.aborted) { reject(controller.signal.reason); return; }
    const stop = () => { clearTimeout(timer); reject(controller.signal.reason); };
    const timer = setTimeout(() => { controller.signal.removeEventListener('abort', stop); resolve(); }, ms);
    controller.signal.addEventListener('abort', stop, { once: true });
  }));
  const fetchImpl: typeof fetch = (input, init = {}) => (dependencies.fetch || fetch)(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
  const program = new Command('aholo').description('Independent CLI for official Aholo Asset and Lux3D APIs').version(VERSION).exitOverride().showSuggestionAfterError(false);
  program.configureOutput({ writeOut: text => { parserText += text; }, writeErr: text => { parserText += text; }, outputError: text => { parserText += text; } });
  program.configureHelp({ showGlobalOptions: true });
  program.on('beforeAllHelp', (context: { command: Command }) => { chosen = context.command; });
  for (const f of globalFlags) program.addOption(flagOption(f));
  const commands = new Map<string, Command>([['', program]]), specs = new Map<Command, CommandSpec>();
  for (const spec of catalog) {
    let parent = program;
    spec.path.forEach((part, i) => {
      const key = spec.path.slice(0, i + 1).join(' ');
      let command = commands.get(key);
      if (!command) { command = parent.command(part); commands.set(key, command); }
      parent = command;
    });
    if (specs.has(parent)) throw Error('Duplicate command metadata');
    specs.set(parent, spec); parent.description(spec.description);
    if (spec.argument) parent.argument(before.describe ? spec.argument.replace('<', '[').replace('>', ']') : spec.argument);
    for (const f of flagsFor(spec)) parent.addOption(flagOption(f));
    parent.action(async (...values: unknown[]) => {
      chosen = parent;
      const opts = parent.optsWithGlobals() as Input;
      json = !!opts.json || opts.output === 'json';
      if (opts.describe) { result = { service: 'cli', operation: 'describe', data: describe(spec) }; return; }
      if (opts.output === 'text' && opts.json) usage('--json conflicts with --output text.');
      if (opts.requestId !== undefined) requestName(String(opts.requestId));
      if (spec.path[0] === 'request') { requestName(String(values[0])); if (spec.path[1] === 'attach') taskId(opts.taskId); }
      if ((opts.wait || opts.download || spec.kind === 'wait')) maxWait(opts);
      if (spec.path[0] === 'capabilities') { result = { service: 'cli', operation: 'capabilities', data: describe() }; return; }
      const settings = await settingsFor(opts, env); secret = settings.apiKey;
      const api = () => { requireKey(settings); return dependencies.client ? dependencies.client(settings) : officialClient(settings, fetchImpl); };
      const progress = (text: string) => { if (!opts.quiet) io.err(String(sanitize(text, secret)) + '\n'); };
      if (opts.verbose) progress(`Operation: ${spec.operationId}; CLI ${VERSION}`);
      const wait = (client: ReturnType<typeof api>, id: number) => waitTask(client, id, { maxWait: maxWait(opts), timeout: settings.timeout, pollInterval: settings.pollInterval, now, sleep, signal: controller.signal, progress: task => progress(`Task ${id}: status ${task.status}`) });
      const getId = () => { const id = taskId(values[0]); activeTask = id; return id; };
      if (spec.kind === 'create') {
        const input = await prepare(spec, opts, io);
        if (opts.dryRun) { result = { service: 'lux3d', operation: spec.operationId, data: { dryRun: true, ...contracts.operations[spec.operationId], schema: undefined, body: input.body }, local: { uploads: input.files.map(f => ({ path: f.path, bytes: f.bytes.length, sha256: f.sha256 })), network: false } }; return; }
        const client = api(), store = new RequestStore(settings);
        const requestId = String(opts.requestId ?? randomUUID()); activeRequest = requestId;
        progress(`Request: ${requestId}`);
        const submitted = await store.submit(requestId, spec.operationId, input.identity, async mark => {
          const body = await uploadInputs(input, async f => (await client.upload(f.bytes, f.path, settings.timeout * 1000)).url);
          validateBody(spec.operationId, body);
          controller.signal.throwIfAborted();
          await mark(); return { taskId: await client.create(spec.operationId, body, settings.timeout * 1000) };
        });
        const id = taskId(submitted.record.taskId); activeTask = id;
        const local: Input = { requestId, reused: submitted.reused };
        let data: unknown = { taskId: id };
        if (opts.wait || opts.download) data = await wait(client, id);
        if (opts.download) Object.assign(local, await downloadTask(client, data as Awaited<ReturnType<typeof wait>>, { outDir: settings.outDir, timeout: settings.timeout, overwrite: !!opts.overwrite, fetch: fetchImpl, signal: controller.signal }));
        result = { service: 'lux3d', operation: spec.operationId, data, local }; return;
      }
      if (spec.kind === 'upload') {
        const file = await localFile(String(values[0]), 'file');
        if (opts.dryRun) { result = { service: 'asset', operation: spec.operationId, data: { dryRun: true, bytes: file.bytes.length, sha256: file.sha256 }, local: { path: file.path, network: false } }; return; }
        const client = api(), requestId = String(opts.requestId ?? randomUUID()); activeRequest = requestId;
        const { record, reused } = await new RequestStore(settings).submit(requestId, spec.operationId, { sha256: file.sha256, extension: path.extname(file.path) }, async mark => { await mark(); const output = await client.upload(file.bytes, file.path, settings.timeout * 1000); publicUrl(output.url, 'Uploaded file'); return { result: { url: output.url } }; });
        result = { service: 'asset', operation: spec.operationId, data: record.result, local: { requestId, reused } }; return;
      }
      if (spec.kind === 'list') {
        const body: Input = {}; for (const f of flagsFor(spec)) if (f.field && opts[optionKey(f.flag)] !== undefined) body[f.field] = opts[optionKey(f.flag)];
        validateBody(spec.operationId, body);
        result = { service: 'lux3d', operation: spec.operationId, data: opts.dryRun ? { dryRun: true, query: body, network: false } : await api().list(body, settings.timeout * 1000) }; return;
      }
      if (['get', 'wait', 'download'].includes(spec.kind)) {
        const id = getId();
        if (opts.dryRun) { result = { service: 'lux3d', operation: spec.kind, data: { dryRun: true, taskId: id, network: false } }; return; }
        const client = api(), task = spec.kind === 'wait' ? await wait(client, id) : await client.get(id, settings.timeout * 1000);
        result = { service: 'lux3d', operation: spec.kind, data: task, ...(spec.kind === 'download' ? { local: await downloadTask(client, task, { outDir: settings.outDir, timeout: settings.timeout, overwrite: !!opts.overwrite, fetch: fetchImpl, signal: controller.signal }) } : {}) }; return;
      }
      if (opts.dryRun) { result = { service: 'cli', operation: spec.operationId, data: { dryRun: true, network: false } }; return; }
      switch (spec.path.join(' ')) {
        case 'capabilities': result = { service: 'cli', operation: 'capabilities', data: describe() }; break;
        case 'doctor': result = { service: 'cli', operation: 'doctor', data: { cliVersion: VERSION, node: process.version, settings: publicSettings(settings), networkChecked: false } }; break;
        case 'config show': result = { service: 'cli', operation: spec.operationId, data: publicSettings(settings) }; break;
        case 'config list': result = { service: 'cli', operation: spec.operationId, data: { profiles: Object.keys((await readConfig(settings.home)).profiles) } }; break;
        case 'config set': {
          const config = await readConfig(settings.home), saved: Profile = { ...(config.profiles[settings.profile] || {}) };
          for (const key of ['region', 'baseUrl', 'outDir', 'timeout', 'pollInterval'] as const) if (opts[key] !== undefined) (saved as Input)[key] = settings[key];
          if (opts.apiKeyStdin) { const key = (await io.input()).trim(); if (!key || /\s/.test(key)) usage('stdin must contain one non-empty API key without whitespace.'); saved.apiKey = key; secret = key; }
          config.profiles[settings.profile] = saved; await atomicJson(path.join(settings.home, 'config.json'), config);
          result = { service: 'cli', operation: spec.operationId, data: { home: settings.home, profile: settings.profile, saved: true, apiKeyConfigured: !!saved.apiKey } }; break;
        }
        case 'request get': {
          const record = await new RequestStore(settings).read(String(values[0])); if (!record) throw new CliError('E_NOT_FOUND', 'Local request record not found.', 2);
          result = { service: 'cli', operation: spec.operationId, data: publicRecord(record) }; break;
        }
        case 'request attach': {
          const id = taskId(opts.taskId), requestId = String(values[0]); activeRequest = requestId; activeTask = id;
          const client = api(), store = new RequestStore(settings);
          const record = await store.attach(requestId, id, async () => { await client.get(id, settings.timeout * 1000); });
          result = { service: 'cli', operation: spec.operationId, data: publicRecord(record) }; break;
        }
        case 'skill export': {
          const destination = path.resolve(String(values[0]));
          await mkdir(destination, { recursive: true });
          if ((await readdir(destination)).length) usage('Skill export requires an empty destination directory; existing files will not be replaced.');
          const source = fileURLToPath(new URL('../skills/aholo-cli/', import.meta.url));
          for (const entry of await readdir(source)) await cp(path.join(source, entry), path.join(destination, entry), { recursive: true, force: false, errorOnExist: true });
          result = { service: 'cli', operation: spec.operationId, data: { cliVersion: VERSION, skillVersion: VERSION }, local: { directory: destination } }; break;
        }
        default: throw Error('Missing command executor');
      }
    });
  }
  try {
    await program.parseAsync(args.length ? args : ['--help'], { from: 'user' });
    if (!result) { if (before.describe) result = { service: 'cli', operation: 'describe', data: describe(specs.get(chosen!)) }; else usage('Choose a command; use --help or capabilities.'); }
    const envelope = { schemaVersion: 1, cliVersion: VERSION, ok: true, ...result };
    io.out(json ? JSON.stringify(redactCredentials(envelope, secret)) + '\n' : result.operation === 'help' ? String(result.data) : JSON.stringify(redactCredentials(envelope, secret), null, 2) + '\n'); return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) {
      const data = before.describe ? describe(specs.get(chosen!)) : error.code === 'commander.version' ? { cliVersion: VERSION } : { text: parserText, ...(chosen ? { command: chosen.name() } : {}) };
      io.out(json ? JSON.stringify({ schemaVersion: 1, cliVersion: VERSION, ok: true, service: 'cli', operation: before.describe ? 'describe' : error.code === 'commander.version' ? 'version' : 'help', data }) + '\n' : parserText); return 0;
    }
    const e = error instanceof CliError ? error : error instanceof CommanderError ? new CliError('E_ARGUMENT', error.message, 2) : new CliError('E_LOCAL', error instanceof Error ? error.message : 'Local operation failed.', 1);
    const interrupted = controller.signal.aborted;
    const details = { ...e.details, ...(activeRequest ? { requestId: activeRequest } : {}), ...(activeTask ? { taskId: activeTask } : {}) };
    const value = { schemaVersion: 1, cliVersion: VERSION, ok: false, error: { code: interrupted ? 'E_INTERRUPTED' : e.code, message: interrupted ? 'Local operation interrupted. Query the existing task or inspect the request before retrying.' : e.message, details } };
    io.out(json ? JSON.stringify(sanitize(value, secret)) + '\n' : '');
    if (!json) io.err(JSON.stringify(sanitize(value.error, secret), null, 2) + '\n');
    return interrupted ? 130 : e.exitCode;
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
}
