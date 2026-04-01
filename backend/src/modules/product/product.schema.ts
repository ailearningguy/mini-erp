import { pgTable, uuid, varchar, decimal, integer, timestamp, boolean, index } from 'drizzle-orm/pg-core';

export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  productName: varchar('product_name', { length: 255 }).notNull(),
  sku: varchar('sku', { length: 100 }).notNull().unique(),
  basePrice: decimal('base_price', { precision: 15, scale: 2 }).notNull(),
  stock: integer('stock').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  skuIdx: index('products_sku_idx').on(table.sku),
  activeIdx: index('products_active_idx').on(table.isActive),
}));
