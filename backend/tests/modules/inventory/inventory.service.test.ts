import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { InventoryService } from '@modules/inventory/inventory.service';

function createMockDb() {
  const mockTxResult: any[] = [];
  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() => Promise.resolve(mockTxResult)),
        })),
      })),
    })),
    transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => {
      const mockTx = {
        select: jest.fn(() => ({
          from: jest.fn(() => ({
            where: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve(mockTxResult)),
            })),
          })),
        })),
        update: jest.fn(() => ({
          set: jest.fn(() => ({
            where: jest.fn(() => Promise.resolve({})),
          })),
        })),
        insert: jest.fn(() => ({
          values: jest.fn(() => Promise.resolve({})),
        })),
      };
      return fn(mockTx);
    }),
    _setTxResult: (results: any[]) => { mockTxResult.length = 0; mockTxResult.push(...results); },
  };
}

function createMockEventBus() {
  return {
    emit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

describe('InventoryService', () => {
  let service: InventoryService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockEventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockEventBus = createMockEventBus();
    service = new InventoryService(mockDb as any, mockEventBus as any);
  });

  describe('getByProductId()', () => {
    it('should return null when inventory not found', async () => {
      mockDb._setTxResult([]);
      const result = await service.getByProductId('prod-1');
      expect(result).toBeNull();
    });

    it('should return inventory when found', async () => {
      mockDb._setTxResult([{ id: '1', productId: 'prod-1', quantity: 10, reserved: 2, version: 1, updatedAt: new Date() }]);
      const result = await service.getByProductId('prod-1');
      expect(result).not.toBeNull();
      expect(result!.productId).toBe('prod-1');
      expect(result!.quantity).toBe(10);
    });
  });

  describe('reserve()', () => {
    it('should throw when inventory not found for product', async () => {
      mockDb._setTxResult([]);
      await expect(
        service.reserve('550e8400-e29b-41d4-a716-446655440000', [{ productId: '550e8400-e29b-41d4-a716-446655440001', quantity: 2 }]),
      ).rejects.toThrow(/not found/i);
    });

    it('should throw when insufficient stock', async () => {
      mockDb._setTxResult([{ productId: 'prod-1', quantity: 1, reserved: 0, version: 1 }]);
      await expect(
        service.reserve('550e8400-e29b-41d4-a716-446655440000', [{ productId: '550e8400-e29b-41d4-a716-446655440001', quantity: 5 }]),
      ).rejects.toThrow(/insufficient/i);
    });

    it('should reserve stock when available', async () => {
      mockDb._setTxResult([{ productId: 'prod-1', quantity: 10, reserved: 0, version: 1 }]);
      await service.reserve('550e8400-e29b-41d4-a716-446655440000', [{ productId: '550e8400-e29b-41d4-a716-446655440001', quantity: 3 }]);
      expect(mockDb.transaction).toHaveBeenCalled();
      expect(mockEventBus.emit).toHaveBeenCalled();
    });
  });

  describe('release()', () => {
    it('should emit release event', async () => {
      await service.release('550e8400-e29b-41d4-a716-446655440000');
      expect(mockDb.transaction).toHaveBeenCalled();
      expect(mockEventBus.emit).toHaveBeenCalled();
    });
  });

  describe('adjust()', () => {
    it('should create new inventory when not exists', async () => {
      mockDb._setTxResult([]);
      const result = await service.adjust('550e8400-e29b-41d4-a716-446655440001', 100);
      expect(result.quantity).toBe(100);
      expect(mockEventBus.emit).toHaveBeenCalled();
    });

    it('should update existing inventory', async () => {
      mockDb._setTxResult([{ id: '1', productId: 'prod-1', quantity: 50, reserved: 5, version: 1, updatedAt: new Date() }]);
      const result = await service.adjust('550e8400-e29b-41d4-a716-446655440001', 100);
      expect(result.quantity).toBe(100);
      expect(result.version).toBe(2);
    });
  });
});