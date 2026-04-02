import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { HookExecutor } from '@core/hooks/hook-executor';
import { HookRegistry } from '@core/hooks/hook-registry';
import type { HookContext, HookRegistration } from '@core/hooks/types';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

describe('HookExecutor', () => {
  let registry: HookRegistry;
  let executor: HookExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    registry = new HookRegistry();
    executor = new HookExecutor(registry, mockLogger);
  });

  describe('execute()', () => {
    it('should execute hooks in priority order (lower first)', async () => {
      const order: number[] = [];

      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => { order.push(100); },
        priority: 100,
      });
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => { order.push(50); },
        priority: 50,
      });
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => { order.push(75); },
        priority: 75,
      });

      await executor.execute('order.beforeCreate', 'pre', {});

      expect(order).toEqual([50, 75, 100]);
    });

    it('should default priority to 100 when not specified', async () => {
      const order: string[] = [];

      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async () => { order.push('default'); },
      });
      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async () => { order.push('explicit-50'); },
        priority: 50,
      });

      await executor.execute('test', 'pre', {});

      expect(order).toEqual(['explicit-50', 'default']);
    });

    it('should pass data through context', async () => {
      let receivedData: any;

      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async (ctx: HookContext) => {
          receivedData = ctx.data;
        },
      });

      await executor.execute('test', 'pre', { orderId: '123' });

      expect(receivedData).toEqual({ orderId: '123' });
    });

    it('should allow hooks to modify context data', async () => {
      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async (ctx: HookContext) => {
          ctx.data.discount = 0.1;
        },
        priority: 10,
      });
      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async (ctx: HookContext) => {
          ctx.data.vat = 0.08;
        },
        priority: 20,
      });

      const ctx = await executor.execute('test', 'pre', { price: 100 });

      expect(ctx.data).toEqual({ price: 100, discount: 0.1, vat: 0.08 });
    });

    it('should stop propagation when stopPropagation is set', async () => {
      const executed: string[] = [];

      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async (ctx: HookContext) => {
          executed.push('first');
          ctx.stopPropagation = true;
        },
        priority: 10,
      });
      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async () => {
          executed.push('second');
        },
        priority: 20,
      });

      await executor.execute('test', 'pre', {});

      expect(executed).toEqual(['first']);
    });

    it('should continue on error when failSafe is true (default)', async () => {
      const executed: string[] = [];

      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async () => {
          throw new Error('hook failed');
        },
        priority: 10,
        failSafe: true,
      });
      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async () => {
          executed.push('second');
        },
        priority: 20,
      });

      await executor.execute('test', 'pre', {});

      expect(executed).toEqual(['second']);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should throw on error when failSafe is false', async () => {
      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async () => {
          throw new Error('hook failed');
        },
        failSafe: false,
      });

      await expect(executor.execute('test', 'pre', {})).rejects.toThrow('hook failed');
    });

    it('should timeout handler that takes too long', async () => {
      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async () => {
          await new Promise(r => setTimeout(r, 10_000));
        },
        timeout: 50,
        failSafe: true,
      });

      const ctx = await executor.execute('test', 'pre', {});

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({}),
        'Hook execution failed',
      );
    });

    it('should timeout and throw when failSafe is false', async () => {
      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async () => {
          await new Promise(r => setTimeout(r, 10_000));
        },
        timeout: 50,
        failSafe: false,
      });

      await expect(executor.execute('test', 'pre', {})).rejects.toThrow();
    });

    it('should use point timeout as default when handler timeout not set', async () => {
      registry.registerPoint({
        name: 'test',
        phase: 'pre',
        timeout: 50,
        failSafe: true,
      });

      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async () => {
          await new Promise(r => setTimeout(r, 10_000));
        },
      });

      const ctx = await executor.execute('test', 'pre', {});

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should return context with result', async () => {
      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async (ctx: HookContext) => {
          ctx.result = { calculated: true };
        },
      });

      const ctx = await executor.execute('test', 'pre', {});

      expect(ctx.result).toEqual({ calculated: true });
    });

    it('should generate unique executionId', async () => {
      let execId1: string;
      let execId2: string;

      registry.register({
        point: 'test',
        phase: 'pre',
        handler: async (ctx: HookContext) => {
          if (!execId1) execId1 = ctx.metadata.executionId;
          else execId2 = ctx.metadata.executionId;
        },
      });

      await executor.execute('test', 'pre', {});
      await executor.execute('test', 'pre', {});

      expect(execId1!).not.toBe(execId2!);
    });

    it('should return empty context when no hooks registered', async () => {
      const ctx = await executor.execute('nonexistent', 'pre', { data: 1 });

      expect(ctx.data).toEqual({ data: 1 });
      expect(ctx.result).toBeUndefined();
    });
  });
});