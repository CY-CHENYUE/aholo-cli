import path from 'node:path';
import { createAssetClient } from '@manycore/aholo-sdk-asset';
import { createLux3dClient } from '@manycore/aholo-sdk-lux3d';
import { assertCmdSuccess, createGatewayClient } from '@manycore/aholo-sdk-core';
import type { ApiPort, Input, Settings, TaskResult } from './types.js';
import { catalog } from './catalog.js';
import { taskId } from './contracts.js';
import { CliError, networkError } from './errors.js';

export function officialClient(settings: Settings, fetchImpl: typeof fetch = fetch): ApiPort {
  function config(timeoutMs: number) {
    const budget = AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs)));
    const bounded: typeof fetch = (input, init = {}) => fetchImpl(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, budget]) : budget });
    return { apiKey: settings.apiKey, region: settings.region, baseUrl: settings.baseUrl, timeoutMs: Math.max(1, Math.ceil(timeoutMs)), fetch: bounded, userAgent: 'aholo-cli/0.1.0' };
  }
  return {
    async upload(bytes, filename, timeoutMs) {
      try {
        const c = config(timeoutMs);
        return { ...await createAssetClient(c).uploadBuffer(bytes, { filename: path.basename(filename), partTimeoutMs: c.timeoutMs, signal: AbortSignal.timeout(c.timeoutMs), poll: { timeoutMs: c.timeoutMs } }) };
      } catch (error) { throw networkError(error); }
    },
    async create(operationId, body, timeoutMs) {
      const spec = catalog.find(v => v.operationId === operationId);
      const client = createLux3dClient(config(timeoutMs));
      // Input has already passed the pinned official schema and conditional validation.
      const resource = (client as unknown as Record<string, { create(body: Input): Promise<number> }>)[spec?.sdkMethod || ''];
      if (!resource) throw new CliError('E_UNSUPPORTED', `SDK adapter missing for ${operationId}.`);
      try { return taskId(await resource.create(body)); } catch (error) { throw networkError(error); }
    },
    async get(id, timeoutMs) {
      try {
        // The resource helper drops extra failure fields; the official gateway preserves the full API detail.
        const path = `${settings.region === 'com' ? '/global' : ''}/lux3d/v1/generate/task/get`;
        const envelope = await createGatewayClient(config(timeoutMs)).gatewayRequest({ method: 'GET', path, query: { taskid: id } });
        const data = assertCmdSuccess(envelope as Parameters<typeof assertCmdSuccess>[0], 'tasks.get') as TaskResult;
        if (!data || data.taskId !== id || ![0, 1, 3, 4, 6].includes(data.status)) throw new CliError('E_RESPONSE', 'Official task detail has an invalid ID or status.', 6);
        return data;
      } catch (error) { throw networkError(error); }
    },
    async list(body, timeoutMs) {
      try {
        return await createLux3dClient(config(timeoutMs)).tasks.list({ page: body.page as number | undefined, pageSize: body.pagesize as number | undefined, status: body.status as 0 | 1 | 3 | 4 | undefined, startTime: body.starttime as number | undefined, endTime: body.endtime as number | undefined });
      } catch (error) { throw networkError(error); }
    }
  };
}
