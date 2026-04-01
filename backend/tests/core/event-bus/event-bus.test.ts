import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { EventBus } from '@core/event-bus/event-bus';

describe('EventBus', () => {
  let eventBus: EventBus;
  let mockOutboxRepo: any;
  let mockRegistry: any;

  beforeEach(() => {
    mockOutboxRepo = {
      insert: jest.fn<(...args: any[]) => Promise<any>>(async () => {}),
    };
    mockRegistry = {
      validate: jest.fn(() => true),
      register: jest.fn(),
    };
    eventBus = new EventBus(mockOutboxRepo, mockRegistry);
  });

  it('should throw if tx is not provided', async () => {
    await expect(
      eventBus.emit({ type: 'test.event.v1', source: 'test', aggregate_id: '1', payload: {}, metadata: { version: 'v1' } } as any, null as any),
    ).rejects.toThrow();
  });

  it('should validate event against schema registry', async () => {
    const mockTx = {};
    await eventBus.emit(
      { type: 'product.created.v1', source: 'test', aggregate_id: '1', payload: {}, metadata: { version: 'v1' } } as any,
      mockTx as any,
    );
    expect(mockRegistry.validate).toHaveBeenCalled();
  });

  it('should write event to outbox in same transaction', async () => {
    const mockTx = {};
    await eventBus.emit(
      { type: 'product.created.v1', source: 'test', aggregate_id: '1', payload: {}, metadata: { version: 'v1' } } as any,
      mockTx as any,
    );
    expect(mockOutboxRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'product.created.v1',
        aggregate_id: '1',
      }),
      mockTx,
    );
  });

  it('should auto-generate id and timestamp', async () => {
    const mockTx = {};
    await eventBus.emit(
      { type: 'product.created.v1', source: 'test', aggregate_id: '1', payload: {}, metadata: { version: 'v1' } } as any,
      mockTx as any,
    );
    const call = mockOutboxRepo.insert.mock.calls[0][0];
    expect(call.id).toBeDefined();
    expect(call.timestamp).toBeDefined();
  });
});
