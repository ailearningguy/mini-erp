import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ModuleRegistry } from '@core/module-registry/registry';

describe('ModuleRegistry', () => {
  let registry: ModuleRegistry;

  beforeEach(() => {
    registry = new ModuleRegistry();
  });

  it('should register and retrieve rate limit configs', () => {
    registry.registerRateLimits('product', [
      { eventType: 'product.created.v1', maxEventsPerSecond: 500 },
      { eventType: 'product.updated.v1', maxEventsPerSecond: 500 },
    ]);

    const all = registry.getAllRateLimits();
    expect(all).toHaveLength(2);
    expect(all[0].eventType).toBe('product.created.v1');
    expect(all[1].eventType).toBe('product.updated.v1');
  });

  it('should register and retrieve event handler registrations', () => {
    const handler1 = jest.fn(async () => {});
    const handler2 = jest.fn(async () => {});

    registry.registerEventHandler('product', 'product.created.v1', handler1);
    registry.registerEventHandler('product', 'product.updated.v1', handler2);

    const handlers = registry.getEventHandlers();
    expect(handlers).toHaveLength(2);
    expect(handlers[0].eventType).toBe('product.created.v1');
    expect(handlers[1].eventType).toBe('product.updated.v1');
  });

  it('should throw on duplicate event type rate limit registration', () => {
    registry.registerRateLimits('product', [
      { eventType: 'product.created.v1', maxEventsPerSecond: 500 },
    ]);
    expect(() =>
      registry.registerRateLimits('order', [
        { eventType: 'product.created.v1', maxEventsPerSecond: 100 },
      ]),
    ).toThrow('Rate limit already registered for event type: product.created.v1');
  });

  it('should return empty arrays when nothing registered', () => {
    expect(registry.getAllRateLimits()).toEqual([]);
    expect(registry.getEventHandlers()).toEqual([]);
  });
});