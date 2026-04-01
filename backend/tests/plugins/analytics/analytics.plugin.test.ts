import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AnalyticsPlugin } from '@plugins/analytics/analytics.plugin';

function createMockDb() {
  return {
    insert: jest.fn(() => ({ values: jest.fn(async () => {}) })),
    select: jest.fn(() => ({ from: jest.fn(async () => []) })),
  };
}

describe('AnalyticsPlugin', () => {
  let plugin: AnalyticsPlugin;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    plugin = new AnalyticsPlugin();
    mockDb = createMockDb();
  });

  it('should return correct metadata', () => {
    const meta = plugin.getMetadata();
    expect(meta.name).toBe('analytics');
    expect(meta.trusted).toBe(true);
  });

  it('should initialize module with database', () => {
    plugin.init(mockDb as any);
    expect(plugin.getModule()).not.toBeNull();
    expect(plugin.getService()).not.toBeNull();
  });

  it('should be active after init', () => {
    expect(plugin.isActive()).toBe(false);
    plugin.init(mockDb as any);
    expect(plugin.isActive()).toBe(true);
  });

  it('should record events via service when consumer receives event', async () => {
    plugin.init(mockDb as any);

    const handlers: Record<string, Function> = {};
    const mockConsumer = {
      on: jest.fn((eventType: string, handler: Function) => {
        handlers[eventType] = handler;
      }),
    };

    plugin.setEventConsumer(mockConsumer as any);

    const testEvent = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'product.created.v1',
      source: 'product-service',
      timestamp: new Date().toISOString(),
      aggregate_id: '550e8400-e29b-41d4-a716-446655440001',
      payload: { productId: '550e8400-e29b-41d4-a716-446655440001', productName: 'Test', sku: 'T1', basePrice: 10, stock: 5 },
      metadata: { version: 'v1' },
    };

    await handlers['product.created.v1'](testEvent, {});

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should deactivate cleanly', async () => {
    plugin.init(mockDb as any);
    expect(plugin.isActive()).toBe(true);
    await plugin.onDeactivate();
    expect(plugin.getModule()).not.toBeNull();
  });

  it('should dispose and clean up', async () => {
    plugin.init(mockDb as any);
    await plugin.dispose();
    expect(plugin.getModule()).not.toBeNull();
  });
});