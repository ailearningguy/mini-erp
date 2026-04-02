import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { CapabilityExecutor } from '@core/capability/capability-executor';
import { CapabilityRegistry } from '@core/capability/capability-registry';
import type { CapabilityContext } from '@core/capability/types';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

describe('CapabilityExecutor', () => {
  let registry: CapabilityRegistry;
  let executor: CapabilityExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new CapabilityRegistry();
    executor = new CapabilityExecutor(registry, mockLogger);
  });

  describe('execute() — pipeline', () => {
    beforeEach(() => {
      registry.registerCapability({
        name: 'pricing',
        type: 'pipeline',
        stages: ['base', 'discount', 'tax', 'final'],
      });
    });

    it('should execute handlers in stage order', async () => {
      const order: string[] = [];

      registry.registerHandler({
        capability: 'pricing', stage: 'tax',
        handle: async () => { order.push('tax'); },
      });
      registry.registerHandler({
        capability: 'pricing', stage: 'base',
        handle: async () => { order.push('base'); },
      });
      registry.registerHandler({
        capability: 'pricing', stage: 'discount',
        handle: async () => { order.push('discount'); },
      });

      await executor.execute('pricing', { basePrice: 100 });

      expect(order).toEqual(['base', 'discount', 'tax']);
    });

    it('should sort by priority within same stage', async () => {
      const order: number[] = [];

      registry.registerHandler({
        capability: 'pricing', stage: 'base', priority: 100,
        handle: async () => { order.push(100); },
      });
      registry.registerHandler({
        capability: 'pricing', stage: 'base', priority: 10,
        handle: async () => { order.push(10); },
      });

      await executor.execute('pricing', {});

      expect(order).toEqual([10, 100]);
    });

    it('should pass input through context', async () => {
      let receivedInput: any;

      registry.registerHandler({
        capability: 'pricing', stage: 'base',
        handle: async (ctx: CapabilityContext) => {
          receivedInput = ctx.input;
        },
      });

      await executor.execute('pricing', { basePrice: 100 });

      expect(receivedInput).toEqual({ basePrice: 100 });
    });

    it('should allow handlers to modify context state and result', async () => {
      registry.registerHandler({
        capability: 'pricing', stage: 'base',
        handle: async (ctx: CapabilityContext) => {
          ctx.state.basePrice = ctx.input.basePrice;
          ctx.result = ctx.input.basePrice;
        },
      });
      registry.registerHandler({
        capability: 'pricing', stage: 'discount',
        handle: async (ctx: CapabilityContext) => {
          ctx.state.discount = 0.1;
          ctx.result = ctx.result * 0.9;
        },
      });

      const result = await executor.execute('pricing', { basePrice: 100 });

      expect(result).toBe(90);
    });

    it('should stop when ctx.stop is set', async () => {
      const executed: string[] = [];

      registry.registerHandler({
        capability: 'pricing', stage: 'base', priority: 10,
        handle: async (ctx: CapabilityContext) => {
          executed.push('base');
          ctx.stop = true;
        },
      });
      registry.registerHandler({
        capability: 'pricing', stage: 'discount', priority: 20,
        handle: async () => { executed.push('discount'); },
      });

      await executor.execute('pricing', {});

      expect(executed).toEqual(['base']);
    });

    it('should skip handler when condition returns false', async () => {
      const executed: string[] = [];

      registry.registerHandler({
        capability: 'pricing', stage: 'base',
        condition: () => false,
        handle: async () => { executed.push('base'); },
      });
      registry.registerHandler({
        capability: 'pricing', stage: 'discount',
        handle: async () => { executed.push('discount'); },
      });

      await executor.execute('pricing', {});

      expect(executed).toEqual(['discount']);
    });

    it('should return ctx.result after pipeline completes', async () => {
      registry.registerHandler({
        capability: 'pricing', stage: 'final',
        handle: async (ctx: CapabilityContext) => {
          ctx.result = { finalPrice: 95.50 };
        },
      });

      const result = await executor.execute('pricing', {});

      expect(result).toEqual({ finalPrice: 95.50 });
    });
  });

  describe('execute() — single', () => {
    beforeEach(() => {
      registry.registerCapability({ name: 'payment', type: 'single' });
    });

    it('should execute single handler', async () => {
      registry.registerHandler({
        capability: 'payment',
        handle: async (ctx: CapabilityContext) => {
          ctx.result = { transactionId: 'txn-123' };
        },
      });

      const result = await executor.execute('payment', { amount: 100 });

      expect(result).toEqual({ transactionId: 'txn-123' });
    });

    it('should throw when no handler registered', async () => {
      await expect(executor.execute('payment', {})).rejects.toThrow(/no handler/i);
    });

    it('should throw when multiple handlers registered', async () => {
      registry.registerHandler({ capability: 'payment', handle: async () => {} });
      registry.registerHandler({ capability: 'payment', handle: async () => {} });

      await expect(executor.execute('payment', {})).rejects.toThrow(/single-type/i);
    });
  });

  describe('execute() — composable', () => {
    beforeEach(() => {
      registry.registerCapability({ name: 'analytics', type: 'composable' });
    });

    it('should execute all handlers in parallel', async () => {
      const executed: string[] = [];

      registry.registerHandler({
        capability: 'analytics',
        handle: async () => { executed.push('tracking'); },
      });
      registry.registerHandler({
        capability: 'analytics',
        handle: async () => { executed.push('logging'); },
      });

      await executor.execute('analytics', {});

      expect(executed).toHaveLength(2);
      expect(executed).toContain('tracking');
      expect(executed).toContain('logging');
    });
  });

  describe('execute() — unknown capability', () => {
    it('should throw when capability not found', async () => {
      await expect(executor.execute('nonexistent', {})).rejects.toThrow(/not found/i);
    });
  });
});
