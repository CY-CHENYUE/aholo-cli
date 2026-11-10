import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat, writeFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { fixture, start, until, testKey, png, glb } from './helpers.mjs';
import { waitTask } from '../dist/tasks.js';
import { CliError } from '../dist/errors.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('help, version, describe, unknown command and missing arguments use single JSON without network', async t => {
  const f = await fixture(t);
  for (const args of [['--help'], ['--version'], ['lux3d', 'task', 'get', '--describe'], ['lux3d', 'nonsense'], ['lux3d', 'task', 'get'], ['lux3d', 'text-to-3d', '--wat'], ['lux3d', 'image-to-3d', '--model-version', 'missing']]) {
    const r = await f.run(args, { AHOLO_API_KEY: '' });
    assert.equal(r.value.schemaVersion, 1); assert.ok([0, 2].includes(r.code)); assert.equal(r.stdout.trim().split('\n').length, 1);
  }
  assert.equal(f.calls.length, 0);
});
test('JSON flag is not inferred from prompt text; text mode remains valid', async t => {
  const f = await fixture(t);
  const r = await start(['lux3d', 'text-to-3d', '--prompt=--json', '--dry-run'], f.env).done;
  assert.equal(r.code, 0); assert.ok(r.stdout.includes('\n  "')); assert.equal(r.value.data.body.prompt, '--json');
});
test('stdin request, output json alias and Chinese paths validate without writing state', async t => {
  const f = await fixture(t);
  const r = await start(['lux3d', 'text-to-3d', '--request', '-', '--dry-run', '--output', 'json'], { ...f.env, AHOLO_API_KEY: '' }, { stdin: '{"prompt":"一只机器人"}' }).done;
  assert.equal(r.code, 0); assert.equal(r.value.data.body.prompt, '一只机器人');
  const image = await f.run(['lux3d', 'image-to-3d', '--image', f.image, '--dry-run']);
  assert.equal(image.code, 0); assert.equal(image.value.local.uploads[0].bytes, png.length);
  await assert.rejects(access(f.env.AHOLO_CLI_HOME)); assert.equal(f.calls.length, 0);
});
test('invalid official inputs, duplicate fields and local models fail before authentication/network', async t => {
  const f = await fixture(t), bad = path.join(f.home, 'bad.glb'); await writeFile(bad, 'not-a-model');
  const cases = [
    ['lux3d', 'image-to-3d'], ['lux3d', 'image-to-3d', '--image-url', f.base + '/1.png', '--image-urls', f.base + '/2.png'],
    ['lux3d', 'text-to-3d', '--prompt', '  '], ['lux3d', 'text-to-3d', '--prompt', 'robot', '--style', 'invalid'],
    ['lux3d', 'text-to-3d', '--prompt', 'robot', '--face-count', '999'], ['lux3d', 'text-to-3d', '--prompt', 'robot', '--pbr', 'yes'],
    ['lux3d', 'text-to-3d', '--request', '-', '--prompt', 'twice'], ['lux3d', 'image', '--image-url', 'file:///x'],
    ['lux3d', 'export', '--model-url', f.base + '/x.glb'], ['lux3d', 'retarget', '--model-url', f.base + '/rig.glb', '--animations', 'fake'],
    ['lux3d', 'split', '--model', bad], ['lux3d', 'task', 'get', 'not-id'], ['lux3d', 'task', 'list', '--start-time', '5', '--end-time', '1'],
    ['lux3d', 'text-to-3d', '--prompt', 'robot', '--request-id', '../bad'], ['lux3d', 'task', 'wait', '1', '--max-wait', '0']
  ];
  for (const args of cases) { const r = await f.run(args, { AHOLO_API_KEY: '' }, { stdin: '{"prompt":"once"}' }); assert.equal(r.code, 2, JSON.stringify({ args, r })); }
  assert.equal(f.calls.length, 0);
});
test('official SDK sends all ten creation routes and mapped bodies', async t => {
  const f = await fixture(t);
  const cases = [
    ['image-to-3d', ['--image-url', f.base + '/i.png'], '/lux3d/v1/generate/img-to-3d/task/create', { img: f.base + '/i.png', version: 'G1-Turbo', faceCount: 50000, outputFormat: ['glb'], enablePbr: true, aiPredictSize: true }],
    ['text-to-3d', ['--prompt', 'robot'], '/lux3d/v1/generate/text-to-3d/task/create', { prompt: 'robot', style: 'photorealistic', version: 'G1-Turbo', faceCount: 50000, outputFormat: ['glb'], enablePbr: true, aiPredictSize: true }],
    ['image', ['--prompt', 'robot'], '/lux3d/v1/generate/multimodal-to-image/task/create', { prompt: 'robot' }],
    ['four-view', ['--prompt', 'robot'], '/lux3d/v1/generate/image-to-four-view/task/create', { prompt: 'robot' }],
    ['material-transfer', ['--model-url', f.base + '/m.glb', '--image-url', f.base + '/i.png', '--custom-size', '15'], '/lux3d/v1/generate/material-transfer/task/create', { meshUrl: f.base + '/m.glb', img: f.base + '/i.png', version: 'v3.0-standard', customSize: 15 }],
    ['export', ['--model-url', f.base + '/m.glb', '--formats', 'stl,3mf'], '/lux3d/v1/multi-format-export/task/create', { modelUrl: f.base + '/m.glb', outputFormat: ['stl', '3mf'] }],
    ['split', ['--model-url', f.base + '/m.glb'], '/lux3d/v1/part-split/task/create', { glbUrl: f.base + '/m.glb' }],
    ['articulate', ['--model-url', f.base + '/m.glb', '--prompt', 'open'], '/lux3d/v1/articulation-animation/task/create', { glbUrl: f.base + '/m.glb', prompt: 'open' }],
    ['rig', ['--model-url', 'https://cdn.example.test/m.glb'], '/lux3d/v1/animations/rig/task/create', { modelUrl: 'https://cdn.example.test/m.glb' }],
    ['retarget', ['--model-url', 'https://cdn.example.test/m.glb', '--animations', 'Walk_Loop,Idle_Loop', '--animation-output-mode', 'combined', '--out-format', 'fbx', '--in-place', 'false'], '/lux3d/v1/animations/retarget/task/create', { rigModelUrl: 'https://cdn.example.test/m.glb', animationIds: ['Walk_Loop', 'Idle_Loop'], animationOutputMode: 'combined', outFormat: 'fbx', animateInPlace: false }]
  ];
  for (const [name, args, route, body] of cases) {
    const r = await f.run(['lux3d', name, ...args, '--request-id', name, '--quiet']); assert.equal(r.code, 0, JSON.stringify(r));
    const call = f.calls.at(-1); assert.equal(call.method, 'POST'); assert.equal(call.url.pathname, route); assert.deepEqual(call.body, body); assert.equal(call.headers.authorization, testKey);
    assert.equal(r.stderr, ''); assert.ok(!r.stdout.includes(testKey));
  }
});
test('official SDK upload uses private OUS header and creation consumes uploaded local image', async t => {
  const f = await fixture(t);
  const r = await f.run(['lux3d', 'image-to-3d', '--image', f.image, '--request-id', 'local-image']);
  assert.equal(r.code, 0, JSON.stringify(r));
  const token = f.calls.find(c => c.url.pathname.endsWith('/token'));
  const upload = f.calls.find(c => c.url.pathname.endsWith('/single/upload'));
  assert.equal(token.headers.authorization, testKey); assert.equal(upload.headers.authorization, undefined); assert.equal(upload.headers['ous-token-v2'], 'TEST-OUS-TOKEN');
  assert.ok(upload.raw.includes(png)); assert.equal(f.calls.at(-1).body.img, f.base + '/cdn/input.png');
});
test('standalone upload is reusable by request ID without another SDK upload', async t => {
  const f = await fixture(t);
  const a = await f.run(['asset', 'upload', f.image, '--request-id', 'upload-1']); const count = f.calls.length;
  const b = await f.run(['asset', 'upload', f.image, '--request-id', 'upload-1']);
  assert.equal(a.code, 0); assert.equal(b.value.local.reused, true); assert.equal(f.calls.length, count); assert.equal(b.value.data.url, f.base + '/cdn/input.png');
});
test('official SDK multipart upload resumes only missing blocks and uses private OUS headers', async t => {
  const f = await fixture(t, (call, { reply, ok, base }) => {
    if (call.url.pathname.endsWith('/asset/v1/token')) { reply({ ousToken: 'TEST-OUS-TOKEN', globalDomain: base, blockSize: 8 }); return true; }
    if (call.url.pathname.endsWith('/block/upload/init')) { ok({ lackBlocks: ['1-2'] }); return true; }
    if (call.url.pathname.endsWith('/block/upload/part')) { ok({}); return true; }
  });
  const r = await f.run(['asset', 'upload', f.image, '--request-id', 'multipart']); assert.equal(r.code, 0, JSON.stringify(r));
  const init = f.calls.find(c => c.url.pathname.endsWith('/block/upload/init')); assert.equal(init.url.searchParams.get('size'), String(png.length));
  const parts = f.calls.filter(c => c.url.pathname.endsWith('/block/upload/part')); assert.equal(parts.length, 2);
  for (const c of parts) { assert.equal(c.headers.authorization, undefined); assert.equal(c.headers['ous-token-v2'], 'TEST-OUS-TOKEN'); }
});
test('multi-view local files preserve order and do not mutate source files', async t => {
  const f = await fixture(t); const second = path.join(f.home, '另一张 图.png'); await writeFile(second, Buffer.concat([png, Buffer.from('different')]));
  const before = await readFile(f.image);
  const r = await f.run(['lux3d', 'image-to-3d', '--images', f.image, second, '--request-id', 'views']);
  assert.equal(r.code, 0, JSON.stringify(r)); assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/single/upload')).length, 2);
  assert.deepEqual(f.calls.at(-1).body.imgs, [f.base + '/cdn/input.png', f.base + '/cdn/input.png']); assert.deepEqual(await readFile(f.image), before);
});
test('region com prefixes official gateway paths and preserves list query casing', async t => {
  const f = await fixture(t);
  const r = await f.run(['lux3d', 'task', 'list', '--region', 'com', '--page', '2', '--page-size', '5', '--start-time', '10', '--end-time', '20']);
  assert.equal(r.code, 0); assert.equal(f.calls[0].url.pathname, '/global/lux3d/v1/generate/task/list'); assert.equal(f.calls[0].url.searchParams.get('pagesize'), '5');
  assert.equal(f.calls[0].url.searchParams.get('starttime'), '10');
});
test('config is private, redacted, validated, and explicit options override environment/profile', async t => {
  const f = await fixture(t);
  const saved = await f.run(['config', 'set', '--profile', 'work', '--region', 'com', '--api-key-stdin'], {}, { stdin: 'SAVED-KEY-PRIVATE\n' });
  assert.equal(saved.code, 0); assert.ok(!saved.stdout.includes('SAVED-KEY-PRIVATE'));
  const info = await stat(path.join(f.env.AHOLO_CLI_HOME, 'config.json')); assert.equal(info.mode & 0o777, 0o600);
  const r = await f.run(['config', 'show', '--profile', 'work', '--region', 'cn'], { AHOLO_REGION: 'com' }); assert.equal(r.value.data.region, 'cn'); assert.equal(r.value.data.apiKeyConfigured, true);
  await writeFile(path.join(f.env.AHOLO_CLI_HOME, 'config.json'), '{"version":1,"profiles":{"x":null}}');
  const bad = await f.run(['config', 'show']); assert.equal(bad.code, 2); assert.equal(bad.value.error.code, 'E_CONFIG'); assert.equal(f.calls.length, 0);
});
test('missing key fails with no network; business rejection retains official failure code', async t => {
  const f = await fixture(t, (call, { reply }) => { if (call.url.pathname.endsWith('/task/create')) { reply({ c: 'MODEL_INVALID', m: 'model rejected', f: { reason: 'bad mesh' } }); return true; } });
  const a = await f.run(['lux3d', 'text-to-3d', '--prompt', 'robot'], { AHOLO_API_KEY: '' }); assert.equal(a.code, 6); assert.equal(f.calls.length, 0);
  const b = await f.run(['lux3d', 'text-to-3d', '--prompt', 'robot', '--request-id', 'reject']); assert.equal(b.code, 5); assert.equal(b.value.error.details.remoteCode, 'MODEL_INVALID');
  const c = await f.run(['lux3d', 'text-to-3d', '--prompt', 'robot', '--request-id', 'reject']); assert.equal(c.code, 5); assert.equal(f.calls.length, 1);
});
test('identical request reuses task; changed content or region conflicts without create', async t => {
  const f = await fixture(t); const args = ['lux3d', 'text-to-3d', '--prompt', 'robot', '--request-id', 'stable'];
  const a = await f.run(args), b = await f.run(args); assert.equal(a.code, 0); assert.equal(b.value.local.reused, true); assert.equal(a.value.data.taskId, b.value.data.taskId);
  const c = await f.run([...args, '--face-count', '60000']); assert.equal(c.code, 2); assert.equal(c.value.error.code, 'E_REQUEST_CONFLICT');
  const d = await f.run([...args, '--region', 'com']); assert.equal(d.code, 2); assert.equal(f.calls.length, 1);
});
test('two real processes with same ID only permit one create attempt', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, async (call, { ok }) => { if (call.url.pathname.endsWith('/task/create')) { await gate; ok(98765); return true; } });
  const args = ['lux3d', 'text-to-3d', '--prompt', 'robot', '--request-id', 'concurrent', '--json'];
  const first = start(args, f.env); await until(() => f.calls.length === 1);
  const second = await start(args, f.env).done; assert.equal(second.code, 3); assert.equal(second.value.error.code, 'E_REQUEST_IN_PROGRESS');
  release(); const a = await first.done; assert.equal(a.code, 0); assert.equal(f.calls.length, 1);
});
test('SIGKILL after request sent but before task ID saved recovers as uncertain without another create', async t => {
  const f = await fixture(t, (call) => call.url.pathname.endsWith('/task/create'));
  const args = ['lux3d', 'text-to-3d', '--prompt', 'robot', '--request-id', 'kill-window', '--json'];
  const first = start(args, f.env); await until(() => f.calls.length === 1); first.child.kill('SIGKILL'); assert.equal((await first.done).signal, 'SIGKILL');
  const [a, b] = await Promise.all([start(args, f.env).done, start(args, f.env).done]);
  assert.ok([3, 4].includes(a.code), JSON.stringify(a)); assert.ok([3, 4].includes(b.code), JSON.stringify(b)); assert.equal(f.calls.length, 1);
  const record = await f.run(['request', 'get', 'kill-window']); assert.equal(record.value.data.status, 'uncertain');
});
test('network disconnect on create is uncertain; manual attach and reuse never create again', async t => {
  const f = await fixture(t, (call) => { if (call.url.pathname.endsWith('/task/create')) { call.res.destroy(); return true; } });
  const args = ['lux3d', 'text-to-3d', '--prompt', 'robot', '--request-id', 'disconnect'];
  const first = await f.run(args); assert.equal(first.code, 4); assert.equal(first.value.error.code, 'E_UNCERTAIN');
  const again = await f.run(args); assert.equal(again.code, 4);
  const attached = await f.run(['request', 'attach', 'disconnect', '--task-id', '456']); assert.equal(attached.code, 0);
  const recovered = await f.run(args); assert.equal(recovered.code, 0); assert.equal(recovered.value.data.taskId, 456); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});
test('claim survives a missing state file; repeated recovery and competing attachments never reopen create', async t => {
  const f = await fixture(t, call => { if (call.url.pathname.endsWith('/task/create')) { call.res.destroy(); return true; } });
  const args = ['lux3d', 'text-to-3d', '--prompt', 'robot', '--request-id', 'claim-only'];
  assert.equal((await f.run(args)).code, 4);
  await rm(path.join(f.env.AHOLO_CLI_HOME, 'requests', 'claim-only.json'));
  const claimPath = path.join(f.env.AHOLO_CLI_HOME, 'requests', '.claims', 'claim-only.json'), initial = await readFile(claimPath, 'utf8');
  const results = await Promise.all(Array.from({ length: 5 }, () => f.run(args)));
  for (const r of results) assert.equal(r.code, 4, JSON.stringify(r));
  assert.equal(await readFile(claimPath, 'utf8'), initial);
  const attachments = await Promise.all([f.run(['request', 'attach', 'claim-only', '--task-id', '7']), f.run(['request', 'attach', 'claim-only', '--task-id', '8'])]);
  assert.deepEqual(attachments.map(r => r.code).sort(), [0, 2]);
  const resumed = await f.run(args); assert.equal(resumed.code, 0); assert.ok([7, 8].includes(resumed.value.data.taskId));
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});
test('malformed successful HTTP create response is uncertain rather than a definite rejection', async t => {
  const f = await fixture(t, (call, { reply }) => { if (call.url.pathname.endsWith('/task/create')) { reply({ d: 98765 }); return true; } });
  const r = await f.run(['lux3d', 'text-to-3d', '--prompt', 'robot', '--request-id', 'malformed']);
  assert.equal(r.code, 4); assert.equal(r.value.error.code, 'E_UNCERTAIN');
  const again = await f.run(['lux3d', 'text-to-3d', '--prompt', 'robot', '--request-id', 'malformed']); assert.equal(again.code, 4); assert.equal(f.calls.length, 1);
});
test('local save failure after a successful create preserves known task ID and never suggests a new submission', async t => {
  const f = await fixture(t);
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./state-save-worker.mjs', import.meta.url)), path.join(f.home, 'fault-state')]);
  const r = JSON.parse(stdout); assert.deepEqual(r.first, { code: 'E_STATE_SAVE', exitCode: 4, taskId: 775 });
  assert.equal(r.state.status, 'submitted'); assert.equal(r.state.taskId, 775); assert.equal(r.resumed.reused, true); assert.equal(r.creates, 1);
});
test('one create invocation can wait through pending states and download its output', async t => {
  let queries = 0;
  const f = await fixture(t, (call, { ok, base }) => { if (call.url.pathname.endsWith('/task/get')) { queries++; ok({ taskId: 123457, status: queries < 3 ? 1 : 3, outputs: queries < 3 ? [] : [{ content: base + '/model.glb' }] }); return true; } });
  const r = await f.run(['lux3d', 'text-to-3d', '--prompt', 'robot', '--request-id', 'full-chain', '--download', '--max-wait', '2', '--out-dir', path.join(f.home, 'out'), '--verbose']);
  assert.equal(r.code, 0, JSON.stringify(r)); assert.equal(r.value.data.status, 3); assert.equal(r.value.local.files.length, 1); assert.equal(queries, 3);
  assert.ok(r.stderr.includes('status 1')); assert.ok(!r.stderr.includes(testKey)); assert.equal(r.stdout.trim().split('\n').length, 1);
});
test('durably saved task resumes wait and downloads after a different process exits', async t => {
  const f = await fixture(t);
  const created = await f.run(['lux3d', 'text-to-3d', '--prompt', 'robot', '--request-id', 'persisted']);
  const id = created.value.data.taskId;
  const waited = await f.run(['lux3d', 'task', 'wait', String(id), '--max-wait', '1']); assert.equal(waited.code, 0);
  const downloaded = await f.run(['lux3d', 'task', 'download', String(id), '--out-dir', path.join(f.home, '生成 结果')]);
  assert.equal(downloaded.code, 0); assert.deepEqual(await readFile(downloaded.value.local.files[0].path), glb);
  assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/task/create')).length, 1);
  assert.equal(f.calls.find(c => c.url.pathname.startsWith('/cdn')).headers.authorization, undefined);
});
test('wait bounds individual request timeout by total remaining budget', async () => {
  let time = 1000, observed = [];
  const api = { async get(id, timeout) { observed.push(timeout); time += 50; return { taskId: id, status: 1 }; } };
  await assert.rejects(waitTask(api, 42, { maxWait: 0.2, timeout: 60, pollInterval: 12, now: () => time, sleep: async ms => { time += ms; }, progress() {} }), e => e instanceof CliError && e.exitCode === 3 && e.details.taskId === 42);
  assert.deepEqual(observed, [200]);
});
test('slow queries respect real wait deadline and do not create another task', async t => {
  const f = await fixture(t, call => call.url.pathname.endsWith('/task/get'));
  const before = Date.now(); const r = await f.run(['lux3d', 'task', 'wait', '55', '--max-wait', '0.15']);
  assert.equal(r.code, 3, JSON.stringify(r)); assert.ok(Date.now() - before < 1500); assert.equal(f.calls.length, 1);
});
test('official failure preserves output error JSON and uses failure exit code for wait', async t => {
  const payload = '{"error":{"code":"MODEL_NOT_RIGGABLE","message":"bad mesh"}}';
  const f = await fixture(t, (call, { ok }) => { if (call.url.pathname.endsWith('/task/get')) { ok({ taskId: 7, status: 4, outputs: [{ content: payload }], failureCode: 'RIG_FAILED' }); return true; } });
  const r = await f.run(['lux3d', 'task', 'wait', '7']); assert.equal(r.code, 5); assert.equal(r.value.error.details.official.outputs[0].content, payload); assert.equal(r.value.error.details.official.failureCode, 'RIG_FAILED');
});
test('four-view arrays and action output JSON download every file; no API headers reach CDN', async t => {
  const f = await fixture(t, (call, { ok, base }) => { if (call.url.pathname.endsWith('/task/get')) { ok({ taskId: 7, status: 3, outputs: [{ content: JSON.stringify([base + '/a.png', base + '/b.png', base + '/c.png', base + '/d.png']) }, { content: 'NOT_REQUESTED' }, { content: JSON.stringify({ actions: [{ animation_id: 'Idle_Loop', status: 'success', animationGlbUrl: base + '/idle.glb' }] }) }] }); return true; } });
  const r = await f.run(['lux3d', 'task', 'download', '7', '--out-dir', path.join(f.home, 'out')]); assert.equal(r.code, 0, JSON.stringify(r)); assert.equal(r.value.local.files.length, 5);
  assert.equal(f.calls.filter(c => !c.url.pathname.includes('/lux3d/')).length, 5); for (const c of f.calls.slice(1)) { assert.equal(c.headers.authorization, undefined); assert.equal(c.headers['ous-token-v2'], undefined); }
});
test('download refreshes expired URLs by querying the existing task and never generates', async t => {
  let queries = 0;
  const f = await fixture(t, (call, { ok, reply, base }) => {
    if (call.url.pathname.endsWith('/task/get')) { queries++; ok({ taskId: 7, status: 3, outputs: [{ content: base + `/model.glb?token=${queries}` }] }); return true; }
    if (call.url.searchParams.get('token') === '1') { reply({ error: 'expired' }, 403); return true; }
  });
  const r = await f.run(['lux3d', 'task', 'download', '7', '--out-dir', path.join(f.home, 'out')]); assert.equal(r.code, 0, JSON.stringify(r)); assert.equal(queries, 2); assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  const manifest = await readFile(path.join(r.value.local.directory, 'files.json'), 'utf8'); assert.ok(!manifest.includes('token='));
});
test('one task refresh updates all remaining expired output URLs', async t => {
  let queries = 0;
  const f = await fixture(t, (call, { ok, reply, base }) => {
    if (call.url.pathname.endsWith('/task/get')) { queries++; ok({ taskId: 7, status: 3, outputs: [{ content: base + `/a.glb?token=${queries}` }, { content: base + `/b.glb?token=${queries}` }] }); return true; }
    if (call.url.searchParams.get('token') === '1') { reply({ error: 'expired' }, 403); return true; }
  });
  const r = await f.run(['lux3d', 'task', 'download', '7', '--out-dir', path.join(f.home, 'out')]);
  assert.equal(r.code, 0, JSON.stringify(r)); assert.equal(r.value.local.files.length, 2); assert.equal(queries, 2);
  assert.equal(f.calls.filter(c => c.url.searchParams.get('token') === '1').length, 1);
});
test('partial download retains complete files, rejects truncated/invalid GLB, and retry reuses saved files', async t => {
  let fail = true;
  const f = await fixture(t, (call, { ok, base }) => {
    if (call.url.pathname.endsWith('/task/get')) { ok({ taskId: 9, status: 3, outputs: [{ content: base + '/good.glb' }, { content: base + '/bad.glb' }] }); return true; }
    if (call.url.pathname === '/bad.glb' && fail) { call.res.end(Buffer.from('incomplete')); return true; }
  });
  const args = ['lux3d', 'task', 'download', '9', '--out-dir', path.join(f.home, 'out')];
  const r = await f.run(args); assert.equal(r.code, 6); assert.equal(r.value.error.details.files.length, 1); assert.equal(r.value.error.details.failures.length, 1);
  const files = await readdir(r.value.error.details.directory); assert.ok(files.includes('01-good.glb')); assert.ok(!files.some(n => n.endsWith('.part') || n.endsWith('02-bad.glb')));
  fail = false; const again = await f.run(args); assert.equal(again.code, 0); assert.equal(again.value.local.files[0].reused, true); assert.equal(f.calls.filter(c => c.url.pathname === '/good.glb').length, 1);
});
test('download HTTP truncation removes partial file and preserves correct retry state', async t => {
  const f = await fixture(t, call => { if (call.url.pathname.endsWith('/cdn/model.glb')) { call.res.writeHead(200, { 'Content-Length': 1000 }); call.res.write(glb); call.res.destroy(); return true; } });
  const r = await f.run(['lux3d', 'task', 'download', '7', '--out-dir', path.join(f.home, 'out')]); assert.equal(r.code, 6); assert.equal(r.value.error.details.files.length, 0);
  assert.deepEqual(await readdir(path.join(f.home, 'out', 'task-7')), []);
});
test('download refuses conflicting files unless overwrite is explicitly requested', async t => {
  const f = await fixture(t), args = ['lux3d', 'task', 'download', '7', '--out-dir', path.join(f.home, 'out')];
  const a = await f.run(args); const file = a.value.local.files[0].path; await writeFile(file, 'user contents');
  const b = await f.run(args); assert.equal(b.code, 6); assert.equal(b.value.error.details.failures[0].code, 'E_FILE_EXISTS'); assert.equal(await readFile(file, 'utf8'), 'user contents');
  const c = await f.run([...args, '--overwrite']); assert.equal(c.code, 0); assert.deepEqual(await readFile(file), glb);
});
test('partial official action failure saves available files and reports failure honestly', async t => {
  const f = await fixture(t, (call, { ok, base }) => { if (call.url.pathname.endsWith('/task/get')) { ok({ taskId: 7, status: 3, outputs: [{ content: JSON.stringify({ actions: [{ animation_id: 'Walk_Loop', animationGlbUrl: base + '/walk.glb', status: 'success' }, { animation_id: 'Swim_Idle_Loop', status: 'failed', error: { code: 'ANIMATION_RETARGET_FAILED' } }] }) }] }); return true; } });
  const r = await f.run(['lux3d', 'task', 'download', '7', '--out-dir', path.join(f.home, 'out')]); assert.equal(r.code, 5); assert.equal(r.value.error.code, 'E_PARTIAL_OUTPUT'); assert.equal(r.value.error.details.files.length, 1);
});
test('SIGINT exits 130 during wait and leaves official task available for continuation', async t => {
  const f = await fixture(t, (call, { ok }) => { if (call.url.pathname.endsWith('/task/get')) { ok({ taskId: 7, status: 1 }); return true; } });
  const run = start(['lux3d', 'task', 'wait', '7', '--poll-interval', '30', '--json'], f.env); await until(() => f.calls.length > 0); await new Promise(resolve => setTimeout(resolve, 50)); run.child.kill('SIGINT');
  const r = await run.done; assert.equal(r.code, 130); assert.equal(r.value.error.details.taskId, 7); assert.equal(f.calls.filter(c => c.method !== 'GET').length, 0);
});
test('SIGINT during a streamed download removes the partial file and returns 130', async t => {
  const f = await fixture(t, call => { if (call.url.pathname.endsWith('/cdn/model.glb')) { call.res.writeHead(200, { 'Content-Length': glb.length }); call.res.write(glb.subarray(0, 8)); return true; } });
  const out = path.join(f.home, 'out');
  const proc = start(['lux3d', 'task', 'download', '7', '--out-dir', out, '--json'], f.env);
  await until(() => f.calls.some(c => c.url.pathname.endsWith('/cdn/model.glb'))); await new Promise(resolve => setTimeout(resolve, 40)); proc.child.kill('SIGINT');
  const r = await proc.done; assert.equal(r.code, 130, JSON.stringify(r)); assert.equal(r.value.error.details.taskId, 7);
  assert.deepEqual(await readdir(path.join(out, 'task-7')), []);
});
test('Skill export is explicit, version matched, and does not overwrite an existing directory', async t => {
  const f = await fixture(t), destination = path.join(f.home, 'exported skill');
  const r = await f.run(['skill', 'export', destination]); assert.equal(r.code, 0); assert.equal(r.value.data.cliVersion, r.value.data.skillVersion); assert.ok((await readFile(path.join(destination, 'SKILL.md'), 'utf8')).includes('0.1.0'));
  const repeated = await f.run(['skill', 'export', destination]); assert.equal(repeated.code, 2); assert.equal(f.calls.length, 0);
});
