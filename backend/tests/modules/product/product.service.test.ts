import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ProductService } from '@modules/product/product.service';
import { AppError, ErrorCode } from '@shared/errors';

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
    it('should throw NOT_FOUND when product does not exist', async () => {
      mockDb._mockResult.length = 0;
      await expect(service.delete('nonexistent')).rejects.toThrow(AppError);
    });

    it('should soft delete and emit event', async () => {
      mockDb._mockResult.push({ id: '1', productName: 'Test', sku: 'T1' });
      await service.delete('1');
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'product.deleted.v1' }),
        expect.anything(),
      );
    });
  });
});
