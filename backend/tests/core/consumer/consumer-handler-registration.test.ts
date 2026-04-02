import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { EventConsumer } from '@core/consumer/consumer';

function createMockConsumer() {
  return new EventConsumer(
    { has: jest.fn(async () => false), mark: jest.fn(async () => {}) } as any,
    { validate: jest.fn((_: string, data: unknown) => data) } as any,
    { checkLimit: jest.fn(() => true) } as any,
    async (fn: any) => fn({ insert: jest.fn(), update: jest.fn(), select: jest.fn() }),
  );
}

describe('EventConsumer handler registration', () => {
  it('should allow registering multiple handlers via registerHandlers', () => {
    const consumer = createMockConsumer();
    const handler1 = jest.fn(async () => {});
    const handler2 = jest.fn(async () => {});

    consumer.registerHandlers([
      { eventType: 'product.created.v1', handler: handler1 },
      { eventType: 'order.created.v1', handler: handler2 },
    ]);

    const registeredTypes = consumer.getRegisteredHandlerTypes();
    expect(registeredTypes).toContain('product.created.v1');
    expect(registeredTypes).toContain('order.created.v1');
  });

  it('should throw if registerHandlers conflicts with existing handler', () => {
    const consumer = createMockConsumer();
    consumer.registerHandler('product.created.v1', jest.fn(async () => {}));

    expect(() =>
      consumer.registerHandlers([
        { eventType: 'product.created.v1', handler: jest.fn(async () => {}) },
      ]),
    ).toThrow('Handler already registered for event type: product.created.v1');
  });

  it('should return empty array when no handlers registered', () => {
    const consumer = createMockConsumer();
    expect(consumer.getRegisteredHandlerTypes()).toEqual([]);
  });
});