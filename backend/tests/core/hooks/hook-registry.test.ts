import { describe, it, expect } from '@jest/globals';

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