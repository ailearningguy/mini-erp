import { z } from 'zod';

export const InventoryReservedEventSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('inventory.reserved.v1'),
  source: z.string(),
  timestamp: z.string().datetime(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    orderId: z.string().uuid(),
    items: z.array(z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().positive(),
    })),
  }),
  metadata: z.object({
    version: z.literal('v1'),
  }),
});

export type InventoryReservedEvent = z.infer<typeof InventoryReservedEventSchema>;

export const InventoryReleasedEventSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('inventory.released.v1'),
  source: z.string(),
  timestamp: z.string().datetime(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    orderId: z.string().uuid(),
    reason: z.string(),
  }),
  metadata: z.object({
    version: z.literal('v1'),
  }),
});

export type InventoryReleasedEvent = z.infer<typeof InventoryReleasedEventSchema>;

export const InventoryAdjustedEventSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('inventory.adjusted.v1'),
  source: z.string(),
  timestamp: z.string().datetime(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    productId: z.string().uuid(),
    previousQuantity: z.number().int(),
    newQuantity: z.number().int(),
  }),
  metadata: z.object({
    version: z.literal('v1'),
  }),
});

export type InventoryAdjustedEvent = z.infer<typeof InventoryAdjustedEventSchema>;