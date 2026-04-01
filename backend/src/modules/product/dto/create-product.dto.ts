import { z } from 'zod';

export const CreateProductDtoSchema = z.object({
  productName: z.string().min(1).max(255),
  sku: z.string().min(1).max(100),
  basePrice: z.number().positive(),
  stock: z.number().int().min(0).default(0),
});

export type CreateProductDto = z.infer<typeof CreateProductDtoSchema>;

export const UpdateProductDtoSchema = z.object({
  productName: z.string().min(1).max(255).optional(),
  basePrice: z.number().positive().optional(),
  stock: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
});

export type UpdateProductDto = z.infer<typeof UpdateProductDtoSchema>;
