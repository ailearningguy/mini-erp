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
import { ProcessedEventStore, processedEvents } from '@core/consumer/processed-event.schema';
import { EventConsumer } from '@core/consumer/consumer';
import { EventRateLimiter } from '@core/consumer/rate-limiter';
import { CacheService } from '@core/cache/cache.service';
import Redis from 'ioredis';
import { eq } from 'drizzle-orm';
import type { AnyDb } from '@shared/types/db';

describe('Phase 2 E2E: Product → Outbox → Consumer → Cache', () => {
  let db: AnyDb;
  let eventBus: EventBus;
  let eventRegistry: EventSchemaRegistry;
  let outboxRepo: OutboxRepository;
  let productService: ProductService;
  let eventConsumer: EventConsumer;
  let eventStore: ProcessedEventStore;
  let cacheService: CacheService;
  let redis: Redis;
  let outboxTable: typeof outbox;
  let processedEventsTable: typeof processedEvents;

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
    redis = new Redis(config.redis.url);

    eventRegistry = new EventSchemaRegistry();
    eventRegistry.register('product.created.v1', ProductCreatedEventSchema);
    eventRegistry.register('product.updated.v1', ProductUpdatedEventSchema);
    eventRegistry.register('product.deactivated.v1', ProductDeactivatedEventSchema);

    outboxRepo = new OutboxRepository(db);
    eventBus = new EventBus(outboxRepo, eventRegistry);
    productService = new ProductService(db, eventBus);
    eventStore = new ProcessedEventStore(db);
    cacheService = new CacheService(redis as any);
    outboxTable = outbox;
    processedEventsTable = processedEvents;
    eventConsumer = new EventConsumer(
      eventStore,
      eventRegistry,
      new EventRateLimiter([]),
      (fn) => (db as any).transaction(fn),
    );

    eventConsumer.on('product.created.v1', async () => {});
    eventConsumer.on('product.updated.v1', async (event) => {
      await cacheService.invalidate(`product:${event.aggregate_id}`);
    });
    eventConsumer.on('product.deactivated.v1', async (event) => {
      await cacheService.invalidate(`product:${event.aggregate_id}`);
    });
  });

  afterAll(async () => {
    const pool = (db as any).$client;
    if (pool) await pool.end();
    if (redis) await redis.quit();
  });

  describe('E2E: Create product → Consumer processes → Cache updated', () => {
    const testSku = `TEST-E2E-${Date.now()}`;
    let createdProductId: string;

    it('should complete full flow: create, emit, process, cache', async () => {
      const dto = {
        productName: 'E2E Test Product',
        sku: testSku,
        basePrice: 199.99,
        stock: 50,
      };

      const created = await productService.create(dto);
      createdProductId = created.id;

      expect(created).toBeDefined();
      expect(created.productName).toBe(dto.productName);

      const outboxEntry = await (db as any)
        .select()
        .from(outbox)
        .where(eq(outbox.eventType, 'product.created.v1'))
        .then((rows: any[]) => rows.find((r: any) => r.aggregateId === created.id));

      expect(outboxEntry).toBeDefined();
      expect(outboxEntry.status).toBe('pending');

      await eventConsumer.consume({
        id: outboxEntry.eventId,
        type: outboxEntry.eventType,
        aggregate_id: outboxEntry.aggregateId,
        payload: outboxEntry.payload,
        source: outboxEntry.source,
        timestamp: new Date().toISOString(),
        metadata: { version: 'v1' },
      });

      const processed = await eventStore.has(outboxEntry.eventId);
      expect(processed).toBe(true);
    });

    it('should update product and invalidate cache', async () => {
      const cacheKey = `product:${createdProductId}`;
      await cacheService.set(cacheKey, { id: createdProductId, productName: 'Old Name' }, 300);

      const beforeCache = await cacheService.get<any>(cacheKey);
      expect(beforeCache).not.toBeNull();

      await productService.update(createdProductId, { productName: 'New Name', version: 1 });

      const updatedOutboxEntry = await (db as any)
        .select()
        .from(outbox)
        .where(eq(outbox.eventType, 'product.updated.v1'))
        .then((rows: any[]) => rows.find((r: any) => r.aggregateId === createdProductId));

      expect(updatedOutboxEntry).toBeDefined();

      await eventConsumer.consume({
        id: updatedOutboxEntry.eventId,
        type: updatedOutboxEntry.eventType,
        aggregate_id: updatedOutboxEntry.aggregateId,
        payload: updatedOutboxEntry.payload,
        source: updatedOutboxEntry.source,
        timestamp: new Date().toISOString(),
        metadata: { version: 'v1' },
      });

      const afterCache = await cacheService.get<any>(cacheKey);
      expect(afterCache).toBeNull();
    });

    afterEach(async () => {
      if (createdProductId) {
        try {
          await productService.delete(createdProductId);
        } catch {}
      }
      try {
        await cacheService.invalidate(`product:${createdProductId}`);
      } catch {}
    });
  });

  describe('Idempotency: Same event delivered twice', () => {
    const testSku = `TEST-IDEMP-${Date.now()}`;
    let createdProductId: string;
    let eventId: string;

    it('should process same event only once', async () => {
      const dto = {
        productName: 'Idempotency Test',
        sku: testSku,
        basePrice: 50.0,
        stock: 10,
      };

      const created = await productService.create(dto);
      createdProductId = created.id;

      const outboxEntry = await (db as any)
        .select()
        .from(outbox)
        .where(eq(outbox.eventType, 'product.created.v1'))
        .then((rows: any[]) => rows.find((r: any) => r.aggregateId === created.id));

      eventId = outboxEntry.eventId;

      await eventConsumer.consume({
        id: outboxEntry.eventId,
        type: outboxEntry.eventType,
        aggregate_id: outboxEntry.aggregateId,
        payload: outboxEntry.payload,
        source: outboxEntry.source,
        timestamp: new Date().toISOString(),
        metadata: { version: 'v1' },
      });
      await eventConsumer.consume({
        id: outboxEntry.eventId,
        type: outboxEntry.eventType,
        aggregate_id: outboxEntry.aggregateId,
        payload: outboxEntry.payload,
        source: outboxEntry.source,
        timestamp: new Date().toISOString(),
        metadata: { version: 'v1' },
      });
      await eventConsumer.consume({
        id: outboxEntry.eventId,
        type: outboxEntry.eventType,
        aggregate_id: outboxEntry.aggregateId,
        payload: outboxEntry.payload,
        source: outboxEntry.source,
        timestamp: new Date().toISOString(),
        metadata: { version: 'v1' },
      });

      const result = await (db as any)
        .select()
        .from(processedEventsTable)
        .where(eq(processedEventsTable.eventId, eventId));

      expect(result.length).toBe(1);
    });

    afterEach(async () => {
      if (createdProductId) {
        try {
          await productService.delete(createdProductId);
        } catch {}
      }
    });
  });
});