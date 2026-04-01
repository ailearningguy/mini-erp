import { z } from 'zod';

export const EventEnvelopeSchema = z.object({
  id: z.string().uuid(),
  type: z.string().regex(/^[a-z]+\.[a-z]+\.v\d+$/, 'Event type must match {module}.{action}.v{version}'),
  source: z.string().min(1),
  timestamp: z.string().datetime(),
  aggregate_id: z.string().uuid(),
  payload: z.record(z.unknown()),
  metadata: z.object({
    version: z.string().regex(/^v\d+$/),
    correlation_id: z.string().uuid().optional(),
    causation_id: z.string().uuid().optional(),
  }),
});

export type EventEnvelope<T = Record<string, unknown>> = {
  id: string;
  type: string;
  source: string;
  timestamp: string;
  aggregate_id: string;
  payload: T;
  metadata: {
    version: string;
    correlation_id?: string;
    causation_id?: string;
  };
};
