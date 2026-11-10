import { CliError } from './errors.js';
import type { ApiPort, TaskResult } from './types.js';

export function assertCompleted(task: TaskResult): void {
  if ([4, 6].includes(task.status)) throw new CliError('E_TASK_FAILED', `Official task ${task.taskId} ${task.status === 6 ? 'was canceled' : 'failed'}.`, 5, { taskId: task.taskId, official: task });
  if (task.status !== 3) throw new CliError('E_TASK_PENDING', `Official task ${task.taskId} is still running.`, 3, { taskId: task.taskId, official: task });
}
export async function waitTask(api: ApiPort, id: number, options: { maxWait: number; timeout: number; pollInterval: number; now: () => number; sleep: (ms: number) => Promise<void>; progress: (task: TaskResult) => void; signal?: AbortSignal }): Promise<TaskResult> {
  const deadline = options.now() + options.maxWait * 1000;
  let last: TaskResult | undefined, errors = 0;
  while (true) {
    options.signal?.throwIfAborted();
    const remaining = deadline - options.now();
    if (remaining <= 0) throw new CliError('E_WAIT_TIMEOUT', 'The wait deadline elapsed. Continue with the same task ID.', 3, { taskId: id, ...(last ? { official: last } : {}) });
    try {
      last = await api.get(id, Math.min(options.timeout * 1000, remaining));
      errors = 0; options.progress(last);
      if ([3, 4, 6].includes(last.status)) { assertCompleted(last); return last; }
    } catch (error) {
      if (!(error instanceof CliError) || !['E_NETWORK', 'E_RATE_LIMIT'].includes(error.code) || ++errors > 2) throw error;
    }
    const rest = deadline - options.now();
    if (rest > 0) await options.sleep(Math.min(options.pollInterval * 1000, rest));
  }
}
