import type { HookContext } from './types';

interface IHookExecutor {
  execute(point: string, phase: 'pre' | 'post', data: unknown): Promise<HookContext>;
}

export type { IHookExecutor };
