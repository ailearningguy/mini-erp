import { pgTable, uuid, integer, timestamp, unique } from 'drizzle-orm/pg-core';

export const inventory = pgTable('inventory', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').notNull().unique(),
  quantity: integer('quantity').notNull().default(0),
  reserved: integer('reserved').notNull().default(0),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  productIdx: unique('inventory_product_unique').on(table.productId),
}));