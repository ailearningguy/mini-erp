import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ProductController } from '@modules/product/product.controller';
import { AppError, ErrorCode } from '@shared/errors';

function createMockReq(overrides: any = {}) {
  return {
    params: {},
    query: {},
    body: {},
    id: 'test-request-id',
    headers: {},
    ...overrides,
  } as any;
}

function createMockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) { res.statusCode = code; return res; },
    json(data: any) { res.body = data; return res; },
    send() { return res; },
  };
  return res;
}

function createMockService() {
  return {
    getById: jest.fn<(...args: any[]) => Promise<any>>(async () => null),
    list: jest.fn<(...args: any[]) => Promise<any>>(async () => ({ items: [], nextCursor: null })),
    create: jest.fn<(...args: any[]) => Promise<any>>(async (dto: any) => ({ id: '1', ...dto })),
    update: jest.fn<(...args: any[]) => Promise<any>>(async (id: string, dto: any) => ({ id, ...dto })),
    delete: jest.fn<(...args: any[]) => Promise<any>>(async () => {}),
  };
}

describe('ProductController', () => {
  let controller: ProductController;
  let mockService: ReturnType<typeof createMockService>;

  beforeEach(() => {
    mockService = createMockService();
    controller = new ProductController(mockService as any);
  });

  describe('getById', () => {
    it('should return 404 when product not found', async () => {
      mockService.getById.mockResolvedValue(null);
      const req = createMockReq({ params: { id: 'missing' } });
      const res = createMockRes();
      const next = jest.fn();

      await controller.getById(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(AppError));
    });

    it('should return product when found', async () => {
      mockService.getById.mockResolvedValue({ id: '1', productName: 'Test' });
      const req = createMockReq({ params: { id: '1' } });
      const res = createMockRes();
      const next = jest.fn();

      await controller.getById(req, res, next);
      expect(res.body.data.id).toBe('1');
    });
  });

  describe('list', () => {
    it('should return paginated list', async () => {
      mockService.list.mockResolvedValue({ items: [{ id: '1' }], nextCursor: null });
      const req = createMockReq({ query: { limit: '10' } });
      const res = createMockRes();
      const next = jest.fn();

      await controller.list(req, res, next);
      expect(res.body.data).toEqual([{ id: '1' }]);
      expect(res.body.meta.pagination.has_more).toBe(false);
    });

    it('should cap limit at MAX_PAGE_SIZE', async () => {
      mockService.list.mockResolvedValue({ items: [], nextCursor: null });
      const req = createMockReq({ query: { limit: '999' } });
      const res = createMockRes();
      const next = jest.fn();

      await controller.list(req, res, next);
      expect(mockService.list).toHaveBeenCalledWith(100, undefined);
    });
  });

  describe('delete', () => {
    it('should return 204 on success', async () => {
      const req = createMockReq({ params: { id: '1' } });
      const res = createMockRes();
      const next = jest.fn();

      await controller.delete(req, res, next);
      expect(res.statusCode).toBe(204);
    });
  });
});
