import { describe, it, expect, beforeEach } from '@jest/globals';
import { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import { z } from 'zod';

describe('EventSchemaRegistry cleanup', () => {
  let registry: EventSchemaRegistry;

  beforeEach(() => {
    registry = new EventSchemaRegistry();
  });

  it('should unregister a specific event type', () => {
    registry.register('test.event.v1', z.object({ id: z.string() }));
    expect(registry.hasSchema('test.event.v1')).toBe(true);

    registry.unregister('test.event.v1');
    expect(registry.hasSchema('test.event.v1')).toBe(false);
  });

  it('unregister should be safe for non-existent type', () => {
    registry.unregister('nonexistent.v1');
  });

  it('should clear all schemas', () => {
    registry.register('event.a.v1', z.object({}));
    registry.register('event.b.v1', z.object({}));

    registry.clear();

    expect(registry.getRegisteredTypes()).toHaveLength(0);
  });
});
