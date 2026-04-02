import { z } from 'zod';

export const CreateOrderDtoSchema = z.object({
  customerId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).min(1, 'Order must have at least one item'),
});

export type CreateOrderDto = z.infer<typeof CreateOrderDtoSchema>;