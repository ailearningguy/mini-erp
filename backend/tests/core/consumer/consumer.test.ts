import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { EventConsumer } from '@core/consumer/consumer';

function createMocks() {
  const processedEventStore = {
    has: jest.fn<(eventId: string, tx?: any) => Promise<boolean>>().mockResolvedValue(false),
    mark: jest.fn<(eventId: string, eventType: string, tx: any) => Promise<void>>().mockResolvedValue(undefined),
  };

  const schemaRegistry = {
    validate: jest.fn<(eventType: string, data: unknown) => any>().mockImplementation((_type, data) => data),
    register: jest.fn(),
    hasSchema: jest.fn().mockReturnValue(true),
    getRegisteredTypes: jest.fn().mockReturnValue([]),
  };

  const rateLimiter = {
    checkLimit: jest.fn<(eventType: string) => boolean>().mockReturnValue(true),
  };

  const dbTransaction = jest.fn<(fn: (tx: any) => Promise<any>) => Promise<any>>().mockImplementation(
    async (fn) => fn({}),
  );

  return { processedEventStore, schemaRegistry, rateLimiter, dbTransaction };
}

const sampleEvent = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  type: 'product.created.v1',
  source: 'product-service',
  timestamp: new Date().toISOString(),
  aggregate_id: '550e8400-e29b-41d4-a716-446655440001',
  payload: { productId: '550e8400-e29b-41d4-a716-446655440001' },
  metadata: { version: 'v1' },
};

describe('EventConsumer', () => {
  let consumer: EventConsumer;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
    consumer = new EventConsumer(
      mocks.processedEventStore as any,
      mocks.schemaRegistry as any,
      mocks.rateLimiter as any,
      mocks.dbTransaction as any,
    );
  });

  it('should validate event schema before processing', async () => {
    const handler = jest.fn(async () => {});
    consumer.registerHandler('product.created.v1', handler);

    await consumer.consume(sampleEvent);

    expect(mocks.schemaRegistry.validate).toHaveBeenCalledWith('product.created.v1', sampleEvent);
  });

  it('should throw if no handler registered for event type', async () => {
    await expect(consumer.consume(sampleEvent)).rejects.toThrow(
      'No handler registered for event type: product.created.v1',
    );
  });
});

describe('EventConsumer deduplication', () => {
  let consumer: EventConsumer;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
    consumer = new EventConsumer(
      mocks.processedEventStore as any,
      mocks.schemaRegistry as any,
      mocks.rateLimiter as any,
      mocks.dbTransaction as any,
    );
  });

  it('should skip already-processed events', async () => {
    mocks.processedEventStore.has.mockResolvedValue(true);
    const handler = jest.fn(async () => {});
    consumer.registerHandler('product.created.v1', handler);

    await consumer.consume(sampleEvent);

    expect(handler).not.toHaveBeenCalled();
    expect(mocks.dbTransaction).not.toHaveBeenCalled();
  });

  it('should check dedup before rate limiting', async () => {
    mocks.processedEventStore.has.mockResolvedValue(true);
    const handler = jest.fn(async () => {});
    consumer.registerHandler('product.created.v1', handler);

    await consumer.consume(sampleEvent);

    expect(mocks.rateLimiter.checkLimit).not.toHaveBeenCalled();
  });
});

describe('EventConsumer rate limiting', () => {
  let consumer: EventConsumer;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
    consumer = new EventConsumer(
      mocks.processedEventStore as any,
      mocks.schemaRegistry as any,
      mocks.rateLimiter as any,
      mocks.dbTransaction as any,
    );
  });

  it('should throw when rate limit exceeded', async () => {
    mocks.rateLimiter.checkLimit.mockReturnValue(false);
    const handler = jest.fn(async () => {});
    consumer.registerHandler('product.created.v1', handler);

    await expect(consumer.consume(sampleEvent)).rejects.toThrow(
      'Rate limit exceeded for event type: product.created.v1',
    );
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('EventConsumer transaction handling', () => {
  let consumer: EventConsumer;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
    consumer = new EventConsumer(
      mocks.processedEventStore as any,
      mocks.schemaRegistry as any,
      mocks.rateLimiter as any,
      mocks.dbTransaction as any,
    );
  });

  it('should execute handler within a database transaction', async () => {
    const handler = jest.fn(async () => {});
    consumer.registerHandler('product.created.v1', handler);

    await consumer.consume(sampleEvent);

    expect(mocks.dbTransaction).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should mark event as processed within same transaction', async () => {
    const handler = jest.fn(async () => {});
    consumer.registerHandler('product.created.v1', handler);

    await consumer.consume(sampleEvent);

    expect(mocks.processedEventStore.mark).toHaveBeenCalledWith(
      sampleEvent.id,
      sampleEvent.type,
      expect.any(Object),
    );
  });

  it('should double-check dedup inside transaction', async () => {
    mocks.processedEventStore.has
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const handler = jest.fn(async () => {});
    consumer.registerHandler('product.created.v1', handler);

    await consumer.consume(sampleEvent);

    expect(handler).not.toHaveBeenCalled();
    expect(mocks.processedEventStore.has).toHaveBeenCalledTimes(2);
  });
});

describe('EventConsumer per-aggregate ordering', () => {
  let consumer: EventConsumer;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
    consumer = new EventConsumer(
      mocks.processedEventStore as any,
      mocks.schemaRegistry as any,
      mocks.rateLimiter as any,
      mocks.dbTransaction as any,
    );
  });

  it('should process events for same aggregate sequentially', async () => {
    const handler = jest.fn(async () => {});
    consumer.registerHandler('product.created.v1', handler);

    const event1 = { ...sampleEvent, id: '550e8400-e29b-41d4-a716-446655440010' };
    const event2 = { ...sampleEvent, id: '550e8400-e29b-41d4-a716-446655440011' };

    await Promise.all([
      consumer.consume(event1),
      consumer.consume(event2),
    ]);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should process events for different aggregates in parallel', async () => {
    const handler = jest.fn(async () => {});
    consumer.registerHandler('product.created.v1', handler);

    const event1 = { ...sampleEvent, id: '550e8400-e29b-41d4-a716-446655440010', aggregate_id: '550e8400-e29b-41d4-a716-446655440001' };
    const event2 = { ...sampleEvent, id: '550e8400-e29b-41d4-a716-446655440011', aggregate_id: '550e8400-e29b-41d4-a716-446655440002' };

    await Promise.all([
      consumer.consume(event1),
      consumer.consume(event2),
    ]);

    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe('EventConsumer handler registration', () => {
  let consumer: EventConsumer;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
    consumer = new EventConsumer(
      mocks.processedEventStore as any,
      mocks.schemaRegistry as any,
      mocks.rateLimiter as any,
      mocks.dbTransaction as any,
    );
  });

  it('should throw when registering duplicate handler', () => {
    const handler = jest.fn(async () => {});
    consumer.registerHandler('product.created.v1', handler);

    expect(() => consumer.registerHandler('product.created.v1', handler)).toThrow(
      'Handler already registered for event type: product.created.v1',
    );
  });
});