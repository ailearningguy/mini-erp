import { pgTable, uuid, timestamp, varchar, index } from 'drizzle-orm/pg-core';
import { eq, sql } from 'drizzle-orm';

export const processedEvents = pgTable('processed_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id').notNull().unique(),
  eventType: varchar('event_type', { length: 255 }).notNull(),
  processedAt: timestamp('processed_at').defaultNow().notNull(),
}, (table) => ({
  eventIdIdx: index('processed_events_event_id_idx').on(table.eventId),
}));

type AnyDb = Record<string, unknown>;

class ProcessedEventStore {
  constructor(private readonly db: AnyDb) {}

  async has(eventId: string, tx?: AnyDb): Promise<boolean> {
    const db = (tx ?? this.db) as any;
    const result = await db
      .select({ id: processedEvents.id })
      .from(processedEvents)
      .where(eq(processedEvents.eventId, eventId))
      .limit(1);
    return result.length > 0;
  }

  async mark(eventId: string, eventType: string, tx: AnyDb): Promise<void> {
    await (tx as any).insert(processedEvents).values({
      eventId,
      eventType,
    });
  }
}

export { ProcessedEventStore };
