import { describe, it, expect, beforeEach } from '@jest/globals';
import { AnalyticsPlugin } from '@plugins/analytics/analytics.plugin';

describe('AnalyticsPlugin', () => {
  let plugin: AnalyticsPlugin;

  beforeEach(() => {
    plugin = new AnalyticsPlugin();
  });

  it('should have zero events initially', () => {
    expect(plugin.getEventCount()).toBe(0);
  });

  it('should track events when EventConsumer processes them', async () => {
    await plugin.onActivate();
    expect(plugin.isActive()).toBe(true);
    await plugin.onDeactivate();
    expect(plugin.isActive()).toBe(false);
  });

  it('should register handlers for all tracked events', async () => {
    const handlers: Record<string, Function> = {};
    const mockConsumer = {
      on: (eventType: string, handler: Function) => { handlers[eventType] = handler; },
    };

    plugin.setEventConsumer(mockConsumer as any);

    expect(handlers['product.created.v1']).toBeDefined();
    expect(handlers['product.updated.v1']).toBeDefined();
    expect(handlers['order.created.v1']).toBeDefined();
    expect(handlers['order.completed.v1']).toBeDefined();
    expect(Object.keys(handlers)).toHaveLength(4);
  });

  it('should push event to events array when handler is called', async () => {
    const mockConsumer = {
      on: (eventType: string, handler: Function) => {},
    };
    plugin.setEventConsumer(mockConsumer as any);

    let capturedHandler: Function | null = null;
    const mockConsumer2 = {
      on: (eventType: string, handler: Function) => {
        if (eventType === 'product.created.v1') capturedHandler = handler;
      },
    };
    plugin.setEventConsumer(mockConsumer2 as any);

    expect(plugin.getEventCount()).toBe(0);
    await capturedHandler!({
      id: '1',
      type: 'product.created.v1',
      source: 'test',
      aggregate_id: 'agg-1',
      timestamp: '2026-04-01T00:00:00Z',
      payload: { productId: '1' },
      metadata: { version: 'v1' },
    }, {});
    expect(plugin.getEventCount()).toBe(1);
  });
});
