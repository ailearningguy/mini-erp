import { pgTable, uuid, varchar, text, jsonb, timestamp, integer, index } from 'drizzle-orm/pg-core';

export const outbox = pgTable('outbox', {
  id: uuid('id').defaultRandom().primaryKey(),
  eventId: uuid('event_id').notNull(),
  eventType: varchar('event_type', { length: 255 }).notNull(),
  source: text('source').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  payload: jsonb('payload').notNull(),
  metadata: jsonb('metadata'),
  status: varchar('status', { length: 50 }).default('pending').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  nextAttemptAt: timestamp('next_attempt_at'),
  lockedAt: timestamp('locked_at'),
  lockedBy: varchar('locked_by', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at'),
}, (table) => ({
  statusIdx: index('outbox_status_idx').on(table.status),
  createdAtIdx: index('outbox_created_at_idx').on(table.createdAt),
}));

export const outboxDlq = pgTable('outbox_dlq', {
  id: uuid('id').defaultRandom().primaryKey(),
  originalEventId: uuid('original_event_id').notNull(),
  eventType: varchar('event_type', { length: 255 }).notNull(),
  payload: jsonb('payload').notNull(),
  source: text('source').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  failureReason: text('failure_reason').notNull(),
  attempts: integer('attempts').notNull(),
  failedAt: timestamp('failed_at').defaultNow().notNull(),
});
