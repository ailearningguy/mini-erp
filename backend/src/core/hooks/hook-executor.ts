import { randomUUID } from 'node:crypto';
import type { HookContext, HookRegistration } from './types';
import type { HookRegistry } from './hook-registry';
import type { IHookExecutor } from './hook-executor.interface';

interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

class HookExecutor implements IHookExecutor {
  constructor(
    private registry: HookRegistry,
    private logger: Logger,
  ) {}

  async execute<TData = unknown>(pointName: string, phase: 'pre' | 'post', data: TData): Promise<HookContext<TData>> {
    const point = this.registry.getPoint(pointName);
    const hooks = this.registry.getHooks(pointName, phase);

    if (hooks.length === 0) {
      return {
        data,
        result: undefined,
        stopPropagation: false,
        metadata: { point: pointName, phase, executionId: randomUUID() },
      };
    }

    const sorted = [...hooks].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

    const ctx: HookContext = {
      data,
      result: undefined,
      stopPropagation: false,
      metadata: {
        point: pointName,
        phase,
        executionId: randomUUID(),
      },
    };

    for (const hook of sorted) {
      const timeout = hook.timeout ?? point?.timeout ?? 5000;
      const failSafe = hook.failSafe ?? point?.failSafe ?? true;

      try {
        await Promise.race([
          hook.handler(ctx),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`Hook timeout: ${pointName}:${phase} after ${timeout}ms`)),
              timeout,
            ),
          ),
        ]);

        if (ctx.stopPropagation) break;
      } catch (err) {
        this.logger.error(
          {
            err,
            point: pointName,
            phase,
            plugin: hook.plugin,
            module: hook.module,
            executionId: ctx.metadata.executionId,
          },
          'Hook execution failed',
        );

        if (!failSafe) {
          throw err;
        }
      }
    }

    return ctx;
  }
}

export { HookExecutor };