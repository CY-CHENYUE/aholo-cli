import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { fixture, png, glb } from '../tests/helpers.mjs';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = process.argv[2] ? path.resolve(process.argv[2]) : await mkdtemp(path.join(tmpdir(), 'aholo-cli-package-'));
await mkdir(destination, { recursive: true });
const npmEnv = { ...process.env, ...(process.argv[3] ? { npm_config_cache: process.argv[3] } : {}) };
const packed = JSON.parse((await exec('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], { cwd: root, env: npmEnv })).stdout)[0];
const names = packed.files.map(f => f.path);
for (const name of names) {
  assert.match(name, /^(bin\/|dist\/|schemas\/|skills\/|reference\/|README\.md$|LICENSE$|package\.json$)/);
  assert.ok(!/(^|\/)(\.env|data|_local|node_modules|tests)(\/|$)/.test(name));
}
for (const required of ['bin/aholo.mjs', 'dist/main.js', 'schemas/contracts.json', 'skills/aholo-cli/SKILL.md', 'reference/commands.md', 'README.md']) assert.ok(names.includes(required));
const tarball = path.join(destination, packed.filename), installed = await mkdtemp(path.join(destination, 'installed-'));
const args = ['install', '--prefix', installed, tarball, '--offline', '--ignore-scripts', '--no-audit', '--no-fund'];
if (process.argv[3]) args.push('--cache', process.argv[3]);
await exec('npm', args, { cwd: destination, env: npmEnv });
let cleanup;
try {
  const f = await fixture({ after(fn) { cleanup = fn; } });
  const executable = path.join(installed, 'node_modules', '.bin', 'aholo');
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('AHOLO_')));
  const env = { ...clean, AHOLO_API_KEY: 'PACKAGE-TEST-FAKE-KEY', ...f.env };
  async function run(command) { return JSON.parse((await exec(executable, [...command, '--json'], { cwd: destination, env })).stdout); }
  const version = await run(['--version']); assert.equal(version.cliVersion, '0.1.0');
  const described = await run(['lux3d', 'image-to-3d', '--describe']); assert.equal(described.data.operationId, 'createImgTo3dTask'); assert.equal(described.data.assetSpec.specVersion, '1.0');
  const image = path.join(destination, '安装后的 中文图片.png'); await writeFile(image, png);
  const generated = await run(['lux3d', 'image-to-3d', '--image', image, '--request-id', 'installed-package-test', '--download', '--out-dir', path.join(destination, 'mock-output'), '--max-wait', '2']);
  assert.equal(generated.ok, true); assert.equal(generated.local.files.length, 1); assert.deepEqual(await readFile(generated.local.files[0].path), glb);
  const skillDirectory = await mkdtemp(path.join(destination, 'skill-'));
  const exported = await run(['skill', 'export', skillDirectory]); assert.equal(exported.data.skillVersion, version.cliVersion);
  const report = { cliVersion: version.cliVersion, tarball, sha256: createHash('sha256').update(await readFile(tarball)).digest('hex'), packedFiles: names.length, executable, skillDirectory, sourceIndependent: true, installedOfficialSdkMockChain: true, skillExport: true, noRealAccountRequests: true, packedPaths: names };
  await writeFile(path.join(destination, 'package-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await cleanup?.(); }
