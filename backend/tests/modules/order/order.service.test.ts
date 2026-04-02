import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { OrderService } from '@modules/order/order.service';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

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
  return { emit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) };
}

function createMockInventoryService() {
  return {
    reserve: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    release: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    getByProductId: jest.fn(),
    adjust: jest.fn(),
  };
}

function createMockSagaOrchestrator() {
  return {
    startSaga: jest.fn<() => Promise<string>>().mockResolvedValue('saga-id-123'),
  };
}

function createMockHookExecutor() {
  return {
    execute: jest.fn<(_point: string, _phase: string, _data: any) => Promise<any>>().mockResolvedValue({
      data: {},
      result: undefined,
      stopPropagation: false,
      metadata: { point: '', phase: 'pre', executionId: 'test-id' },
    }),
  };
}

describe('OrderService', () => {
  let service: OrderService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockEventBus: ReturnType<typeof createMockEventBus>;
  let mockInventory: ReturnType<typeof createMockInventoryService>;
  let mockSaga: ReturnType<typeof createMockSagaOrchestrator>;
  let mockHookExecutor: ReturnType<typeof createMockHookExecutor>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockEventBus = createMockEventBus();
    mockInventory = createMockInventoryService();
    mockSaga = createMockSagaOrchestrator();
    mockHookExecutor = createMockHookExecutor();
    service = new OrderService(
      mockDb as any,
      mockEventBus as any,
      mockInventory as any,
      mockSaga as any,
      mockHookExecutor as any,
    );
  });

  describe('create()', () => {
    it('should create order with pending status', async () => {
      const order = await service.create(VALID_UUID, [
        { productId: VALID_UUID, quantity: 2 },
      ]);

      expect(order).toBeDefined();
      expect(order.status).toBe('pending');
      expect(order.customerId).toBe(VALID_UUID);
    });

    it('should execute pre-hooks before creation', async () => {
      await service.create(VALID_UUID, [
        { productId: VALID_UUID, quantity: 2 },
      ]);

      expect(mockHookExecutor.execute).toHaveBeenCalledWith(
        'order.beforeCreate',
        'pre',
        expect.any(Object),
      );
    });

    it('should execute post-hooks after creation', async () => {
      await service.create(VALID_UUID, [
        { productId: VALID_UUID, quantity: 2 },
      ]);

      expect(mockHookExecutor.execute).toHaveBeenCalledWith(
        'order.afterCreate',
        'post',
        expect.any(Object),
      );
    });

    it('should emit order.created.v1 event', async () => {
      await service.create(VALID_UUID, [
        { productId: VALID_UUID, quantity: 2 },
      ]);

      expect(mockEventBus.emit).toHaveBeenCalled();
    });
  });

  describe('confirm()', () => {
    it('should update order status to confirmed', async () => {
      mockDb._setTxResult([{
        id: VALID_UUID,
        orderNumber: 'ORD-001',
        customerId: VALID_UUID,
        status: 'pending',
        totalAmount: '100.00',
        version: 1,
      }]);

      const order = await service.confirm(VALID_UUID);

      expect(order.status).toBe('confirmed');
    });
  });

  describe('cancel()', () => {
    it('should update order status to cancelled', async () => {
      mockDb._setTxResult([{
        id: VALID_UUID,
        orderNumber: 'ORD-001',
        customerId: VALID_UUID,
        status: 'pending',
        totalAmount: '100.00',
        version: 1,
      }]);

      const order = await service.cancel(VALID_UUID);

      expect(order.status).toBe('cancelled');
    });
  });
});