import { describe, it, expect, jest } from '@jest/globals';
import {
  successResponse,
  errorResponse,
  camelCase,
  snakeCase,
  convertKeys,
} from '@core/api/response';
import { AppError, ErrorCode } from '@shared/errors';
import { ZodError, z } from 'zod';

describe('response utilities', () => {
  describe('camelCase', () => {
    it('should convert snake_case to camelCase', () => {
      expect(camelCase('base_price')).toBe('basePrice');
      expect(camelCase('product_name')).toBe('productName');
      expect(camelCase('id')).toBe('id');
    });
  });

  describe('snakeCase', () => {
    it('should convert camelCase to snake_case', () => {
      expect(snakeCase('basePrice')).toBe('base_price');
      expect(snakeCase('productName')).toBe('product_name');
      expect(snakeCase('id')).toBe('id');
    });
  });

  describe('convertKeys', () => {
    it('should convert all keys in an object', () => {
      const input = { basePrice: 100, productName: 'Test' };
      const result = convertKeys(input, snakeCase);
      expect(result).toEqual({ base_price: 100, product_name: 'Test' });
    });

    it('should handle nested objects', () => {
      const input = { outerKey: { innerKey: 'value' } };
      const result = convertKeys(input, snakeCase);
      expect(result).toEqual({ outer_key: { inner_key: 'value' } });
    });

    it('should handle arrays', () => {
      const input = [{ basePrice: 100 }];
      const result = convertKeys(input as any, snakeCase);
      expect(result).toEqual([{ base_price: 100 }]);
    });
  });

  describe('successResponse', () => {
    it('should return formatted success response', () => {
      const result = successResponse({ id: '123' }, 'req-abc');
      expect(result.data).toEqual({ id: '123' });
      expect(result.meta.request_id).toBe('req-abc');
      expect(result.meta.version).toBe('v1');
      expect(result.meta.timestamp).toBeDefined();
    });

    it('should include pagination when provided', () => {
      const result = successResponse([], 'req-abc', { cursor: 'abc', has_more: true, limit: 10 });
      expect(result.meta.pagination).toEqual({ cursor: 'abc', has_more: true, limit: 10 });
    });
  });

  describe('errorResponse', () => {
    it('should format AppError', () => {
      const error = new AppError(ErrorCode.NOT_FOUND, 'Not found', 404);
      const result = errorResponse(error, 'req-abc');
      expect(result.error.code).toBe(ErrorCode.NOT_FOUND);
      expect(result.error.message).toBe('Not found');
      expect(result.error.trace_id).toBe('req-abc');
    });

    it('should format unknown errors', () => {
      const result = errorResponse(new Error('boom'), 'req-abc');
      expect(result.error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(result.error.message).toBe('An unexpected error occurred');
    });
  });

  describe('globalErrorHandler', () => {
    function createReq() {
      return { id: 'req-123' } as any;
    }
    function createRes() {
      const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      return res;
    }

    it('should return 400 for ZodError', () => {
      const schema = z.object({ name: z.string() });
      let zodError: ZodError;
      try {
        schema.parse({ name: 123 });
      } catch (err) {
        zodError = err as ZodError;
      }
      const req = createReq();
      const res = createRes();
      const next = jest.fn();

      const { globalErrorHandler } = require('@core/api/response');
      globalErrorHandler(zodError!, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'VALIDATION_ERROR',
          }),
        }),
      );
    });
  });
});
