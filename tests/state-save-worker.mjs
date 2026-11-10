import promises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const original = promises.rename; let writes = 0;
promises.rename = async (...args) => {
  if (String(args[1]).endsWith('persist-error.json') && ++writes === 3) throw Object.assign(Error('Injected transient EIO'), { code: 'EIO' });
  return original(...args);
};
syncBuiltinESMExports();
const { RequestStore } = await import('../dist/requests.js');
const store = new RequestStore({ home: process.argv[2], profile: 'default', region: 'cn', apiKey: 'FAKE', timeout: 60, pollInterval: 12, outDir: '/tmp' });
let creates = 0, first;
try { await store.submit('persist-error', 'createTextTo3dTask', { prompt: 'robot' }, async mark => { await mark(); creates++; return { taskId: 775 }; }); } catch (error) { first = { code: error.code, exitCode: error.exitCode, taskId: error.details.taskId }; }
const resumed = await store.submit('persist-error', 'createTextTo3dTask', { prompt: 'robot' }, async () => { creates++; return { taskId: 999 }; });
process.stdout.write(JSON.stringify({ first, creates, resumed, state: await store.read('persist-error') }));
