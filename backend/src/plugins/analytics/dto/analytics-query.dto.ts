import { z } from 'zod';

export const AnalyticsQueryDto = z.object({
  event_type: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});

export type AnalyticsQuery = z.infer<typeof AnalyticsQueryDto>;