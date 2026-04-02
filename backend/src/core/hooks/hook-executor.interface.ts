import type { HookContext } from './types';

interface IHookExecutor {
  execute<TData = unknown>(point: string, phase: 'pre' | 'post', data: TData): Promise<HookContext<TData>>;
}

export type { IHookExecutor };
