import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ProcessedEventStore } from '@core/consumer/processed-event.schema';

function createMockDb() {
  const mockDb = {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(async () => [] as any[]),
        })),
      })),
    })),
    insert: jest.fn(() => ({
      values: jest.fn(async () => {}),
    })),
  };
  return mockDb;
}

describe('ProcessedEventStore', () => {
  let store: ProcessedEventStore;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    store = new ProcessedEventStore(mockDb as any);
  });

  it('should return false for unknown event', async () => {
    const result = await store.has('550e8400-e29b-41d4-a716-446655440000');
    expect(result).toBe(false);
  });

  it('should return true for known event', async () => {
    mockDb.select.mockReturnValue({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(async () => [{ id: 'some-id' }] as any[]),
        })),
      })),
    } as any);

    const result = await store.has('550e8400-e29b-41d4-a716-446655440000');
    expect(result).toBe(true);
  });

  it('should use provided transaction for has()', async () => {
    const mockTx = createMockDb();
    mockTx.select.mockReturnValue({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(async () => [] as any[]),
        })),
      })),
    } as any);

    await store.has('550e8400-e29b-41d4-a716-446655440000', mockTx as any);

    expect(mockTx.select).toHaveBeenCalled();
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('should insert processed event with mark()', async () => {
    const mockTx = createMockDb();
    await store.mark('550e8400-e29b-41d4-a716-446655440000', 'product.created.v1', mockTx as any);

    expect(mockTx.insert).toHaveBeenCalled();
  });
});