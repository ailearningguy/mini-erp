import { describe, it, expect } from '@jest/globals';
import { ProductDeletedEventSchema } from '@modules/product/events/product.events';

describe('ProductDeletedEventSchema', () => {
  it('should validate a valid product.deleted.v1 event', () => {
    const event = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'product.deleted.v1',
      source: 'product-service',
      timestamp: '2026-04-01T10:00:00.000Z',
      aggregate_id: '550e8400-e29b-41d4-a716-446655440001',
      payload: {
        productId: '550e8400-e29b-41d4-a716-446655440001',
        productName: 'Deleted Product',
        sku: 'DEL-001',
      },
      metadata: { version: 'v1' },
    };
    const result = ProductDeletedEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it('should reject event with missing payload fields', () => {
    const event = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'product.deleted.v1',
      source: 'product-service',
      timestamp: '2026-04-01T10:00:00.000Z',
      aggregate_id: '550e8400-e29b-41d4-a716-446655440001',
      payload: { productId: '550e8400-e29b-41d4-a716-446655440001' },
      metadata: { version: 'v1' },
    };
    const result = ProductDeletedEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });
});
