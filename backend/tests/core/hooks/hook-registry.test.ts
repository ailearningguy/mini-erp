import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { HookRegistry } from '@core/hooks/hook-registry';
import type { HookRegistration, HookPoint } from '@core/hooks/types';

describe('Hook types contract', () => {
  it('should define valid HookPoint shape', () => {
    const point = {
      name: 'order.beforeCreate',
      phase: 'pre' as const,
      timeout: 3000,
      failSafe: true,
    };

    expect(point.name).toBe('order.beforeCreate');
    expect(point.phase).toBe('pre');
    expect(point.timeout).toBe(3000);
    expect(point.failSafe).toBe(true);
  });

  it('should define valid HookContext shape', () => {
    const ctx = {
      data: { orderId: '123' },
      result: undefined,
      stopPropagation: false,
      metadata: {
        point: 'order.beforeCreate',
        phase: 'pre' as const,
        executionId: 'uuid-123',
      },
    };

    expect(ctx.data.orderId).toBe('123');
    expect(ctx.stopPropagation).toBe(false);
  });
});

describe('HookRegistry', () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  describe('registerPoint()', () => {
    it('should register a hook point', () => {
      const point: HookPoint = {
        name: 'order.beforeCreate',
        phase: 'pre',
        timeout: 3000,
        failSafe: true,
      };

      registry.registerPoint(point);

      expect(registry.getPoint('order.beforeCreate')).toEqual(point);
    });

    it('should overwrite existing point with same name', () => {
      const point1: HookPoint = { name: 'order.beforeCreate', phase: 'pre', timeout: 3000 };
      const point2: HookPoint = { name: 'order.beforeCreate', phase: 'pre', timeout: 5000 };

      registry.registerPoint(point1);
      registry.registerPoint(point2);

      expect(registry.getPoint('order.beforeCreate')?.timeout).toBe(5000);
    });
  });

  describe('register()', () => {
    it('should register a hook handler', () => {
      const hook: HookRegistration = {
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => {},
        module: 'voucher',
        priority: 50,
      };

      registry.register(hook);

      const hooks = registry.getHooks('order.beforeCreate', 'pre');
      expect(hooks).toHaveLength(1);
      expect(hooks[0].module).toBe('voucher');
    });

    it('should allow multiple hooks on same point:phase', () => {
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => {},
        module: 'voucher',
        priority: 50,
      });
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => {},
        module: 'inventory',
        priority: 60,
      });

      expect(registry.getHooks('order.beforeCreate', 'pre')).toHaveLength(2);
    });

    it('should separate hooks by phase', () => {
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => {},
        module: 'voucher',
      });
      registry.register({
        point: 'order.beforeCreate',
        phase: 'post',
        handler: async () => {},
        module: 'notification',
      });

      expect(registry.getHooks('order.beforeCreate', 'pre')).toHaveLength(1);
      expect(registry.getHooks('order.beforeCreate', 'post')).toHaveLength(1);
    });
  });

  describe('getHooks()', () => {
    it('should return empty array for unknown point', () => {
      expect(registry.getHooks('unknown.point', 'pre')).toEqual([]);
    });
  });

  describe('clearByModule()', () => {
    it('should remove all hooks registered by a module', () => {
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => {},
        module: 'voucher',
      });
      registry.register({
        point: 'order.afterCreate',
        phase: 'post',
        handler: async () => {},
        module: 'voucher',
      });
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => {},
        module: 'inventory',
      });

      registry.clearByModule('voucher');

      expect(registry.getHooks('order.beforeCreate', 'pre')).toHaveLength(1);
      expect(registry.getHooks('order.afterCreate', 'post')).toHaveLength(0);
      expect(registry.getHooks('order.beforeCreate', 'pre')[0].module).toBe('inventory');
    });
  });

  describe('clearByPlugin()', () => {
    it('should remove all hooks registered by a plugin', () => {
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => {},
        plugin: 'analytics',
      });
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => {},
        module: 'inventory',
      });

      registry.clearByPlugin('analytics');

      expect(registry.getHooks('order.beforeCreate', 'pre')).toHaveLength(1);
      expect(registry.getHooks('order.beforeCreate', 'pre')[0].module).toBe('inventory');
    });
  });

  describe('clear()', () => {
    it('should remove all hooks', () => {
      registry.register({
        point: 'order.beforeCreate',
        phase: 'pre',
        handler: async () => {},
        module: 'voucher',
      });
      registry.register({
        point: 'order.afterCreate',
        phase: 'post',
        handler: async () => {},
        module: 'notification',
      });

      registry.clear();

      expect(registry.getHooks('order.beforeCreate', 'pre')).toHaveLength(0);
      expect(registry.getHooks('order.afterCreate', 'post')).toHaveLength(0);
    });
  });
});