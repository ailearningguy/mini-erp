import { describe, it, expect, jest } from '@jest/globals';
import { OutboxRepository } from '@core/outbox/outbox.repository';

const mockEvent = {
  id: 'evt-1',
  type: 'test.event.v1',
  source: 'test',
  aggregate_id: 'agg-1',
  payload: { test: true },
  metadata: { version: 'v1' },
  timestamp: new Date().toISOString(),
};

describe('OutboxRepository', () => {
  describe('insert', () => {
    it('should throw when tx is not provided', async () => {
      const mockDb = { insert: jest.fn() };
      const repo = new OutboxRepository(mockDb as any);

      await expect(repo.insert(mockEvent as any, undefined as any)).rejects.toThrow(/transaction/i);
    });

    it('should use provided tx for the insert', async () => {
      const mockDb = { insert: jest.fn() };
      const mockTx = { insert: jest.fn(() => ({ values: jest.fn(async () => {}) })) };
      const repo = new OutboxRepository(mockDb as any);

      await repo.insert(mockEvent as any, mockTx as any);

      expect(mockTx.insert).toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });
});
