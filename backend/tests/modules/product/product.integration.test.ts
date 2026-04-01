import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadConfig } from '@core/config/config';
import { EventBus } from '@core/event-bus/event-bus';
import { OutboxRepository } from '@core/outbox/outbox.repository';
import { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import { ProductService } from '@modules/product/product.service';
import { ProductCreatedEventSchema, ProductUpdatedEventSchema, ProductDeactivatedEventSchema } from '@modules/product/events/product.events';
import { products } from '@modules/product/product.schema';
import { outbox } from '@core/outbox/outbox.schema';
import { eq } from 'drizzle-orm';
import type { AnyDb } from '@shared/types/db';

describe('Phase 1 Integration: Product + Outbox', () => {
  let db: AnyDb;
  let eventBus: EventBus;
  let eventRegistry: EventSchemaRegistry;
  let outboxRepo: OutboxRepository;
  let productService: ProductService;

  beforeAll(async () => {
    const config = loadConfig();

    const pool = new pg.Pool({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.name,
      max: 5,
    });

    db = drizzle(pool) as unknown as AnyDb;

    eventRegistry = new EventSchemaRegistry();
    eventRegistry.register('product.created.v1', ProductCreatedEventSchema);
    eventRegistry.register('product.updated.v1', ProductUpdatedEventSchema);
    eventRegistry.register('product.deactivated.v1', ProductDeactivatedEventSchema);

    outboxRepo = new OutboxRepository(db);
    eventBus = new EventBus(outboxRepo, eventRegistry);

    productService = new ProductService(db, eventBus);
  });

  afterAll(async () => {
    // Cleanup: delete created test product
    const pool = (db as any).$client;
    if (pool) await pool.end();
  });

  describe('Create Product → DB + Outbox in same transaction', () => {
    const testSku = `TEST-${Date.now()}`;
    let createdProductId: string;

    it('should create product and write event to outbox in same transaction', async () => {
      const dto = {
        productName: 'Integration Test Product',
        sku: testSku,
        basePrice: 99.99,
        stock: 100,
      };

      const created = await productService.create(dto);
      createdProductId = created.id;

      expect(created).toBeDefined();
      expect(created.id).toBeDefined();
      expect(created.productName).toBe(dto.productName);
      expect(created.sku).toBe(dto.sku);

      const outboxEntry = await (db as any)
        .select()
        .from(outbox)
        .where(eq(outbox.eventType, 'product.created.v1'))
        .then((rows: any[]) => rows.find((r: any) => r.aggregateId === created.id));

      expect(outboxEntry).toBeDefined();
      expect(outboxEntry?.eventType).toBe('product.created.v1');
      expect(outboxEntry?.aggregateId).toBe(created.id);
      expect(outboxEntry?.source).toBe('product-service');
      expect(outboxEntry?.status).toBe('pending');
    });

    afterEach(async () => {
      // Cleanup: deactivate test product
      if (createdProductId) {
        try {
          await productService.delete(createdProductId);
        } catch {
          // Ignore if already deleted
        }
      }
    });
  });

  describe('Update Product → Outbox event', () => {
    const testSku = `TEST-UPDATE-${Date.now()}`;
    let createdProductId: string;

    beforeEach(async () => {
      const dto = {
        productName: 'Product to Update',
        sku: testSku,
        basePrice: 50.0,
        stock: 10,
      };
      const created = await productService.create(dto);
      createdProductId = created.id;
    });

    it('should update product and write event to outbox', async () => {
      const updates = {
        productName: 'Updated Product Name',
        version: 1,
      };

      const updated = await productService.update(createdProductId, updates);

      expect(updated.productName).toBe(updates.productName);
      expect(updated.version).toBe(2);

      const outboxEntry = await (db as any)
        .select()
        .from(outbox)
        .where(eq(outbox.eventType, 'product.updated.v1'))
        .then((rows: any[]) => rows.find((r: any) => r.aggregateId === createdProductId));

      expect(outboxEntry).toBeDefined();
      expect(outboxEntry?.eventType).toBe('product.updated.v1');
      expect(outboxEntry?.status).toBe('pending');
    });

    afterEach(async () => {
      if (createdProductId) {
        try {
          await productService.delete(createdProductId);
        } catch {
          // Ignore
        }
      }
    });
  });

  describe('Version conflict handling', () => {
    const testSku = `TEST-CONFLICT-${Date.now()}`;

    it('should throw conflict error on version mismatch', async () => {
      const dto = {
        productName: 'Version Test Product',
        sku: testSku,
        basePrice: 25.0,
        stock: 5,
      };

      const created = await productService.create(dto);

      await expect(
        productService.update(created.id, {
          productName: 'Should Fail',
          version: 999, // Wrong version
        }),
      ).rejects.toThrow('Version conflict');
    });
  });
});