import { pgTable, uuid, varchar, jsonb, timestamp, integer, text, index } from 'drizzle-orm/pg-core';

export const sagaState = pgTable('saga_state', {
  id: uuid('id').defaultRandom().primaryKey(),
  sagaId: uuid('saga_id').notNull().unique(),
  sagaName: varchar('saga_name', { length: 100 }).notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  status: varchar('status', { length: 50 }).notNull(),
  currentStep: integer('current_step').notNull().default(0),
  completedSteps: jsonb('completed_steps').notNull().default([]),
  compensatedSteps: jsonb('compensated_steps').notNull().default([]),
  context: jsonb('context').notNull(),
  retryCount: integer('retry_count').notNull().default(0),
  lastError: text('last_error'),
  startedAt: timestamp('started_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  completedAt: timestamp('completed_at'),
  ttlAt: timestamp('ttl_at'),
}, (table) => ({
  statusIdx: index('saga_state_status_idx').on(table.status),
  aggregateIdx: index('saga_state_aggregate_idx').on(table.aggregateId),
}));
