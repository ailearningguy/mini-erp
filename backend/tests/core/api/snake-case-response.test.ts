import { describe, it, expect } from '@jest/globals';
import { convertKeys, snakeCase } from '@core/api/response';

describe('Response snake_case conversion', () => {
  it('should convert response data keys to snake_case', () => {
    const input = { basePrice: '10.00', productName: 'Test', isActive: true };
    const result = convertKeys(input, snakeCase);
    expect(result).toEqual({ base_price: '10.00', product_name: 'Test', is_active: true });
  });

  it('should handle nested meta.pagination', () => {
    const input = {
      data: { basePrice: 10 },
      meta: { requestId: 'abc', hasMore: true },
    };
    const result = convertKeys(input, snakeCase);
    expect(result).toEqual({
      data: { base_price: 10 },
      meta: { request_id: 'abc', has_more: true },
    });
  });
});
