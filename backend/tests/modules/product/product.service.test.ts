import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ProductService } from '@modules/product/product.service';
import { AppError, ErrorCode } from '@shared/errors';
import { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import { ProductDeactivatedEventSchema } from '@modules/product/events/product.events';

function createMockDb() {
  const mockResult: any[] = [];
  const mockTx = {
    insert: jest.fn(() => ({ values: jest.fn(async () => {}) })),
    update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn(async () => {}) })) })),
    select: jest.fn(() => ({ from: jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(async () => mockResult) })) })) })),
  };
  return {
    select: jest.fn(() => ({ from: jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(async () => mockResult) })) })) })),
    transaction: jest.fn(async (fn: any) => fn(mockTx)),
    _mockResult: mockResult,
    _mockTx: mockTx,
  };
}

function createMockEventBus() {
  return {
    emit: jest.fn<(...args: any[]) => Promise<any>>(async () => {}),
  };
}

describe('ProductService', () => {
  let service: ProductService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockEventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockEventBus = createMockEventBus();
    service = new ProductService(mockDb as any, mockEventBus as any);
  });

  describe('getById', () => {
    it('should return null when product not found', async () => {
      mockDb._mockResult.length = 0;
      const result = await service.getById('nonexistent');
      expect(result).toBeNull();
    });

    it('should return product when found', async () => {
      const product = { id: '123', productName: 'Test', sku: 'T1', basePrice: '10.00' };
      mockDb._mockResult.push(product);
      const result = await service.getById('123');
      expect(result).toEqual(product);
    });
  });

  describe('list with cursor pagination', () => {
    it('should filter by cursor when provided', async () => {
      mockDb._mockResult.length = 0;

      let capturedWhereCondition: any = null;
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn((condition: any) => {
            capturedWhereCondition = condition;
            return {
              limit: jest.fn(async () => [
                { id: 'prod-2', productName: 'B', sku: 'B', isActive: true },
                { id: 'prod-3', productName: 'C', sku: 'C', isActive: true },
              ]),
            };
          }),
        })),
      })) as any;

      const result = await service.list(10, 'prod-1');

      expect(capturedWhereCondition).not.toBeNull();
      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('prod-2');
    });

    it('should return nextCursor when more items exist', async () => {
      mockDb._mockResult.length = 0;
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(async () => [
              { id: 'prod-1', productName: 'A', sku: 'A', isActive: true },
              { id: 'prod-2', productName: 'B', sku: 'B', isActive: true },
              { id: 'prod-3', productName: 'C', sku: 'C', isActive: true },
            ]),
          })),
        })),
      })) as any;

      const result = await service.list(2);

      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe('prod-2');
    });

    it('should return null nextCursor when no more items', async () => {
      mockDb._mockResult.length = 0;
      mockDb.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(async () => [
              { id: 'prod-1', productName: 'A', sku: 'A', isActive: true },
            ]),
          })),
        })),
      })) as any;

      const result = await service.list(10);

      expect(result.nextCursor).toBeNull();
    });
  });

  describe('create', () => {
    it('should throw CONFLICT when SKU already exists', async () => {
      mockDb._mockResult.push({ id: '1', sku: 'EXISTING' });
      await expect(
        service.create({ productName: 'Test', sku: 'EXISTING', basePrice: 10, stock: 0 } as any),
      ).rejects.toThrow(AppError);
    });

    it('should create product and emit event', async () => {
      mockDb._mockResult.length = 0;
      const mockTx = mockDb._mockTx;
      mockTx.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(async () => [{ id: 'new-id', productName: 'New', sku: 'NEW', basePrice: '20.00', stock: 5 }]),
          })),
        })),
      }));

      const result = await service.create({ productName: 'New', sku: 'NEW', basePrice: 20, stock: 5 } as any);
      expect(result.productName).toBe('New');
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'product.created.v1' }),
        expect.anything(),
      );
    });
  });

  describe('update', () => {
    it('should read product inside transaction to prevent TOCTOU race', async () => {
      mockDb._mockResult.length = 0;
      const mockTx = mockDb._mockTx;
      mockTx.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(async () => [{ id: '1', productName: 'Test', sku: 'T1', basePrice: '10.00', stock: 5, version: 1 }]),
          })),
        })),
      }));

      await service.update('1', { productName: 'Updated', version: 1 } as any);

      expect(mockDb._mockTx.select).toHaveBeenCalled();
    });

    it('should throw CONFLICT when version mismatch inside transaction', async () => {
      mockDb._mockResult.length = 0;
      mockDb._mockTx.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(async () => [{ id: '1', version: 2 }]),
          })),
        })),
      }));

      await expect(
        service.update('1', { productName: 'Updated', version: 1 } as any),
      ).rejects.toThrow(/version/i);
    });
  });

  describe('delete', () => {
    it('should read product INSIDE transaction to prevent TOCTOU race', async () => {
      mockDb._mockResult.length = 0;

      let selectCalledOnTx = false;
      const mockTx = mockDb._mockTx;
      mockTx.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(async () => {
              selectCalledOnTx = true;
              return [{ id: '1', productName: 'Test', sku: 'T1', isActive: true }];
            }),
          })),
        })),
      }));

      mockDb._mockResult.push({ id: '1', productName: 'Test', sku: 'T1', isActive: true });

      await service.delete('1');

      expect(selectCalledOnTx).toBe(true);
    });

    it('should throw NOT_FOUND when product is deleted by concurrent request inside transaction', async () => {
      mockDb._mockResult.length = 0;

      mockDb._mockResult.push({ id: '1', productName: 'Test', sku: 'T1', isActive: true });

      mockDb._mockTx.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(async () => []),
          })),
        })),
      }));

      await expect(service.delete('1')).rejects.toThrow(/not found/i);
    });

    it('should throw NOT_FOUND when product does not exist', async () => {
      mockDb._mockResult.length = 0;
      mockDb._mockTx.select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(async () => []),
          })),
        })),
      }));
      await expect(service.delete('nonexistent')).rejects.toThrow(AppError);
    });

    it('should soft delete and emit deactivated event', async () => {
      mockDb._mockResult.push({ id: '1', productName: 'Test', sku: 'T1' });
      await service.delete('1');
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'product.deactivated.v1' }),
        expect.anything(),
      );
    });
  });

  describe('event schema registration', () => {
    it('should register schema for product.deactivated.v1 (not product.deleted.v1)', () => {
      const registry = new EventSchemaRegistry();
      registry.register('product.deactivated.v1', ProductDeactivatedEventSchema);

      const event = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'product.deactivated.v1',
        source: 'product-service',
        timestamp: new Date().toISOString(),
        aggregate_id: '550e8400-e29b-41d4-a716-446655440001',
        payload: { productId: '550e8400-e29b-41d4-a716-446655440001', productName: 'Test', sku: 'T1' },
        metadata: { version: 'v1' },
      };

      expect(() => registry.validate('product.deactivated.v1', event)).not.toThrow();
    });

    it('should fail validation if wrong event type registered', () => {
      const registry = new EventSchemaRegistry();
      registry.register('product.deleted.v1', ProductDeactivatedEventSchema);

      const event = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'product.deactivated.v1',
        source: 'product-service',
        timestamp: new Date().toISOString(),
        aggregate_id: '550e8400-e29b-41d4-a716-446655440001',
        payload: { productId: '550e8400-e29b-41d4-a716-446655440001', productName: 'Test', sku: 'T1' },
        metadata: { version: 'v1' },
      };

      expect(() => registry.validate('product.deactivated.v1', event)).toThrow(/No schema registered/);
    });
  });
});
