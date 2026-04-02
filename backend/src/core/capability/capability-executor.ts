import type { Capability, CapabilityContext } from './types';
import type { CapabilityRegistry } from './capability-registry';

interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

class CapabilityExecutor {
  constructor(
    private registry: CapabilityRegistry,
    private logger: Logger,
  ) {}

  async execute(name: string, input: any): Promise<any> {
    const cap = this.registry.getCapability(name);
    if (!cap) {
      throw new Error(`Capability "${name}" not found`);
    }

    const ctx: CapabilityContext = {
      input,
      state: {},
      result: undefined,
      stop: false,
    };

    switch (cap.type) {
      case 'pipeline':
        return this.executePipeline(name, cap, ctx);
      case 'single':
        return this.executeSingle(name, ctx);
      case 'composable':
        return this.executeComposable(name, ctx);
    }
  }

  private async executePipeline(
    name: string,
    cap: Capability,
    ctx: CapabilityContext,
  ): Promise<any> {
    const handlers = this.registry.getHandlers(name);
    const stageOrder = cap.stages ?? [];

    const sorted = [...handlers].sort((a, b) => {
      const aIdx = stageOrder.indexOf(a.stage ?? '');
      const bIdx = stageOrder.indexOf(b.stage ?? '');
      const aOrder = aIdx === -1 ? 999 : aIdx;
      const bOrder = bIdx === -1 ? 999 : bIdx;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (a.priority ?? 100) - (b.priority ?? 100);
    });

    for (const handler of sorted) {
      if (handler.condition && !handler.condition(ctx)) {
        this.logger.info(
          { capability: name, stage: handler.stage, module: handler.module, plugin: handler.plugin },
          'Capability handler skipped (condition false)',
        );
        continue;
      }

      await handler.handle(ctx);

      if (ctx.stop) break;
    }

    return ctx.result;
  }

  private async executeSingle(name: string, ctx: CapabilityContext): Promise<any> {
    const handlers = this.registry.getHandlers(name);

    if (handlers.length === 0) {
      throw new Error(`No handler registered for capability "${name}"`);
    }
    if (handlers.length > 1) {
      throw new Error(
        `Capability "${name}" is single-type but has ${handlers.length} handlers`,
      );
    }

    await handlers[0].handle(ctx);
    return ctx.result;
  }

  private async executeComposable(name: string, ctx: CapabilityContext): Promise<any> {
    const handlers = this.registry.getHandlers(name);

    await Promise.all(handlers.map(h => h.handle(ctx)));

    return ctx.result;
  }
}

export { CapabilityExecutor };
