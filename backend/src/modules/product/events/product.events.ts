import { z } from 'zod';

export const ProductCreatedEventSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('product.created.v1'),
  source: z.string(),
  timestamp: z.string().datetime(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    productId: z.string().uuid(),
    productName: z.string().min(1).max(255),
    sku: z.string().min(1).max(100),
    basePrice: z.number().positive(),
    stock: z.number().int().min(0),
  }),
  metadata: z.object({
    version: z.literal('v1'),
  }),
});

export type ProductCreatedEvent = z.infer<typeof ProductCreatedEventSchema>;

export const ProductUpdatedEventSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('product.updated.v1'),
  source: z.string(),
  timestamp: z.string().datetime(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    productId: z.string().uuid(),
    changes: z.record(z.unknown()),
    previousVersion: z.number().int(),
  }),
  metadata: z.object({
    version: z.literal('v1'),
  }),
});

export type ProductUpdatedEvent = z.infer<typeof ProductUpdatedEventSchema>;

export const ProductDeactivatedEventSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('product.deactivated.v1'),
  source: z.string(),
  timestamp: z.string().datetime(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    productId: z.string().uuid(),
    productName: z.string().min(1).max(255),
    sku: z.string().min(1).max(100),
  }),
  metadata: z.object({
    version: z.literal('v1'),
  }),
});

export type ProductDeactivatedEvent = z.infer<typeof ProductDeactivatedEventSchema>;

/**
 * @deprecated Use ProductDeactivatedEventSchema instead.
 * This alias exists for backward compatibility only.
 * The canonical event type is 'product.deactivated.v1'.
 */
export const ProductDeletedEventSchema = ProductDeactivatedEventSchema;
export type ProductDeletedEvent = ProductDeactivatedEvent;
