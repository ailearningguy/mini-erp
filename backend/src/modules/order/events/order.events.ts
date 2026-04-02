import { z } from 'zod';

export const OrderCreatedEventSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('order.created.v1'),
  source: z.string(),
  timestamp: z.string().datetime(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    orderId: z.string().uuid(),
    orderNumber: z.string(),
    customerId: z.string().uuid(),
    items: z.array(z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().positive(),
    })),
  }),
  metadata: z.object({
    version: z.literal('v1'),
  }),
});

export type OrderCreatedEvent = z.infer<typeof OrderCreatedEventSchema>;

export const OrderConfirmedEventSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('order.confirmed.v1'),
  source: z.string(),
  timestamp: z.string().datetime(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    orderId: z.string().uuid(),
    orderNumber: z.string(),
  }),
  metadata: z.object({
    version: z.literal('v1'),
  }),
});

export type OrderConfirmedEvent = z.infer<typeof OrderConfirmedEventSchema>;

export const OrderCancelledEventSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('order.cancelled.v1'),
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

export type OrderCancelledEvent = z.infer<typeof OrderCancelledEventSchema>;