import { pgTable, uuid, varchar, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

export const analyticsEvents = pgTable('plugin_analytics_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventType: varchar('event_type', { length: 255 }).notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  data: jsonb('data').notNull(),
  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
}, (table) => ({
  eventTypeIdx: index('plugin_analytics_event_type_idx').on(table.eventType),
  recordedAtIdx: index('plugin_analytics_recorded_at_idx').on(table.recordedAt),
}));