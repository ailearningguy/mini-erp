import { pgTable, uuid, timestamp, varchar } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import type { Db } from '@shared/types/db';

export const processedEvents = pgTable('processed_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id').notNull().unique(),
  eventType: varchar('event_type', { length: 255 }).notNull(),
  processedAt: timestamp('processed_at').defaultNow().notNull(),
});

class ProcessedEventStore {
  constructor(private readonly db: Db) {}

  async has(eventId: string, tx?: Db): Promise<boolean> {
    const database = tx ?? this.db;
    const result = await database
      .select({ id: processedEvents.id })
      .from(processedEvents)
      .where(eq(processedEvents.eventId, eventId))
      .limit(1);
    return result.length > 0;
  }

  async mark(eventId: string, eventType: string, tx: Db): Promise<void> {
    await tx.insert(processedEvents).values({
      eventId,
      eventType,
    });
  }
}

export { ProcessedEventStore };