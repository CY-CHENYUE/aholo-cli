import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const bin = fileURLToPath(new URL('../bin/aholo.mjs', import.meta.url));
export const testKey = 'cli-test-key-NOT-A-REAL-CREDENTIAL';
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=', 'base64');
const json = Buffer.from('{"asset":{"version":"2.0"}}  ');
export const glb = Buffer.alloc(20 + json.length);
glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(json.length, 12); glb.writeUInt32LE(0x4E4F534A, 16); json.copy(glb, 20);
export const zip = Buffer.from('504b0506000000000000000000000000000000000000', 'hex');
export function start(args, env = {}, options = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AHOLO_')));
  const child = spawn(process.execPath, [bin, ...args], { cwd: options.cwd || tmpdir(), env: { ...clean, AHOLO_API_KEY: testKey, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => { let value; try { value = stdout ? JSON.parse(stdout) : undefined; } catch { reject(Error(`Invalid single JSON output: ${stdout}\n${stderr}`)); return; } resolve({ code, signal, value, stdout, stderr }); }); });
  child.stdin.end(options.stdin || '');
  return { child, done };
}
export async function fixture(t, handler) {
  const home = await mkdtemp(path.join(tmpdir(), 'aholo-cli-test-'));
  const image = path.join(home, '中文 参考图.png'), model = path.join(home, '中文 模型.glb');
  await writeFile(image, png); await writeFile(model, glb);
  const calls = [];
  let base, next = 123456;
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const b of req) chunks.push(b);
      const raw = Buffer.concat(chunks), url = new URL(req.url, base);
      let body; try { body = JSON.parse(raw); } catch { /* multipart */ }
      const call = { method: req.method, url, headers: req.headers, body, raw, req, res }; calls.push(call);
      const reply = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
      const ok = d => reply({ c: '0', m: '', f: null, d });
      if (handler && await handler(call, { reply, ok, base, nextTaskId: () => ++next })) return;
      if (url.pathname.endsWith('/asset/v1/token')) return reply({ ousToken: 'TEST-OUS-TOKEN', globalDomain: base, blockSize: 1024 * 1024 });
      if (url.pathname === '/ous/api/v2/single/upload') return ok({});
      if (url.pathname === '/ous/api/v2/upload/status') return ok({ status: 5, url: base + '/cdn/input.png' });
      if (url.pathname.endsWith('/task/create')) return ok(++next);
      if (url.pathname.endsWith('/task/get')) return ok({ taskId: Number(url.searchParams.get('taskid')), status: 3, outputs: [{ content: base + '/cdn/model.glb' }] });
      if (url.pathname.endsWith('/task/list')) return ok({ page: 1, pagesize: 20, total: 1, list: [{ taskId: next, status: 3 }] });
      if (url.pathname.endsWith('.glb')) { res.end(glb); return; }
      if (url.pathname.endsWith('.png')) { res.end(png); return; }
      if (url.pathname.endsWith('.zip')) { res.end(zip); return; }
      reply({ status: 'NOT_FOUND', message: 'Unknown test route' }, 404);
    } catch (e) { if (!res.headersSent) res.writeHead(500); res.end(String(e)); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const env = { AHOLO_CLI_HOME: path.join(home, 'state'), AHOLO_BASE_URL: base, AHOLO_POLL_INTERVAL: '0.01' };
  const run = (args, overrides = {}, options = {}) => start([...args, '--json'], { ...env, ...overrides }, options).done;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(home, { recursive: true, force: true }); });
  return { home, image, model, base, calls, env, run, server };
}
export async function until(fn, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!await fn()) { if (Date.now() > end) throw Error('Test condition timed out'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
