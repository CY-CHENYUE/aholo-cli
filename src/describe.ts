import { catalog, flagsFor, globalFlags } from './catalog.js';
import { assetContracts, contracts } from './contracts.js';
import { VERSION, packageInfo } from './version.js';
import type { CommandSpec } from './types.js';

export function describe(spec?: CommandSpec) {
  const evidence = (s: CommandSpec) => {
    const name = s.path.join(' ');
    const passed = ['lux3d image-to-3d', 'lux3d text-to-3d', 'lux3d task get', 'lux3d task wait', 'lux3d task download'].includes(name);
    const live = s.kind === 'support' ? { status: 'not-applicable' } : name === 'asset upload' ? { status: 'partial', date: '2026-11-10', verified: 'Official single-file SDK upload within image-to-3d.', notRun: ['Standalone upload command', 'Multipart upload on the live service'] } : passed ? { status: 'passed', date: '2026-11-10', scope: 'Two authorized G1-Turbo / GLB robot samples. File and geometry checks passed; visual quality was not reviewed.' } : { status: 'not-run', reason: 'This operation was not exercised in the current live validation.' };
    return { documented: s.kind !== 'support', implemented: true, simulated: { status: 'passed', date: '2026-11-10', suite: 'tests/cli.test.mjs', totalCases: 34 }, live };
  };
  return {
    cliVersion: VERSION, name: packageInfo.name,
    ...(spec ? { command: ['aholo', ...spec.path].join(' '), description: spec.description, operationId: spec.operationId, kind: spec.kind, argument: spec.argument, defaults: spec.defaults || {}, flags: flagsFor(spec), contract: contracts.operations[spec.operationId], implementation: 'implemented' } : { commands: catalog.map(s => ({ command: s.path.join(' '), operationId: s.operationId, kind: s.kind, implementation: 'implemented' })) }),
    ...(spec ? { conditions: spec.conditions || [], verification: evidence(spec), ...(spec.kind === 'upload' ? { assetContract: assetContracts } : {}) } : { verification: catalog.map(s => ({ command: s.path.join(' '), ...evidence(s) })) }),
    assetSpec: { source: assetContracts.source, sourceSha256: assetContracts.sourceSha256, specVersion: assetContracts.specVersion },
    globals: globalFlags, specVersion: contracts.specVersion, source: contracts.source, sourceSha256: contracts.sourceSha256, dependencies: packageInfo.dependencies,
    taskStates: { pending: [0, 1], success: [3], failure: [4, 6] },
    exitCodes: { success: 0, general: 1, argument: 2, pendingOrWaitTimeout: 3, uncertain: 4, officialFailure: 5, networkOrAuthOrDownload: 6, interrupted: 130 }
  };
}
