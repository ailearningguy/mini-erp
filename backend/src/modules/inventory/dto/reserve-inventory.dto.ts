import { z } from 'zod';

export const ReserveInventoryDtoSchema = z.object({
  orderId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).min(1),
});

export type ReserveInventoryDto = z.infer<typeof ReserveInventoryDtoSchema>;

export const AdjustInventoryDtoSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int(),
});

export type AdjustInventoryDto = z.infer<typeof AdjustInventoryDtoSchema>;