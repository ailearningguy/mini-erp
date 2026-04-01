import { z } from 'zod';

export const AnalyticsEventTrackedSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('analytics.event_tracked.v1'),
  source: z.string(),
  timestamp: z.string().datetime(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    originalEventType: z.string(),
    aggregateId: z.string(),
  }),
  metadata: z.object({
    version: z.literal('v1'),
  }),
});

export type AnalyticsEventTracked = z.infer<typeof AnalyticsEventTrackedSchema>;