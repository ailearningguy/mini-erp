import express from 'express';
import helmet from 'helmet';
import { loadConfig } from '@core/config/config';
import { DIContainer } from '@core/di/container';
import { EventBus } from '@core/event-bus/event-bus';
import { OutboxRepository } from '@core/outbox/outbox.repository';
import { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import { EventRateLimiter, defaultEventRateLimits } from '@core/consumer/rate-limiter';
import { ProcessedEventStore } from '@core/consumer/processed-event.schema';
import { EventConsumer } from '@core/consumer/consumer';
import { PluginLoader } from '@core/plugin-system/plugin-loader';
import { ExternalServiceProxy } from '@core/external-integration/proxy';
import { CacheService } from '@core/cache/cache.service';
import { ArchitectureValidator } from '@core/architecture-validator/validator';
import { ProductModule } from '@modules/product/product.module';
import { AnalyticsPlugin } from '@plugins/analytics/analytics.plugin';
import { requestIdMiddleware, snakeCaseMiddleware, globalErrorHandler } from '@core/api/response';
import { API_CONSTANTS } from '@shared/constants';

async function bootstrap(): Promise<void> {
  const config = loadConfig();

  const app = express();

  // --- Middleware ---
  app.use(helmet());
  app.use(express.json());
  app.use(requestIdMiddleware as express.RequestHandler);
  app.use(snakeCaseMiddleware as express.RequestHandler);

  // --- DI Container ---
  const container = new DIContainer();

  // Register core services
  container.register('Config', () => config);
  container.register('EventSchemaRegistry', () => new EventSchemaRegistry());
  container.register('Database', () => {
    // In real implementation: create Drizzle connection
    // const { Pool } = require('pg');
    // const pool = new Pool({ connectionString: ... });
    // return drizzle(pool);
    return {} as any;
  });
  container.register('Redis', () => {
    // In real implementation: create Redis connection
    // const Redis = require('ioredis');
    // return new Redis(config.redis.url);
    return {} as any;
  });
  container.register('OutboxRepository', () => {
    const db = container.resolve('Database');
    return new OutboxRepository(db);
  });
  container.register('EventBus', () => {
    const outboxRepo = container.resolve<OutboxRepository>('OutboxRepository');
    const schemaRegistry = container.resolve<EventSchemaRegistry>('EventSchemaRegistry');
    return new EventBus(outboxRepo, schemaRegistry);
  });
  container.register('EventRateLimiter', () => new EventRateLimiter(defaultEventRateLimits));
  container.register('ProcessedEventStore', () => {
    const db = container.resolve('Database');
    return new ProcessedEventStore(db);
  });
  container.register('EventConsumer', () => {
    const processedStore = container.resolve<ProcessedEventStore>('ProcessedEventStore');
    const schemaRegistry = container.resolve<EventSchemaRegistry>('EventSchemaRegistry');
    const rateLimiter = container.resolve<EventRateLimiter>('EventRateLimiter');
    return new EventConsumer(
      processedStore,
      schemaRegistry,
      rateLimiter,
      (fn) => (container.resolve('Database') as any).transaction(fn),
    );
  });
  container.register('CacheService', () => {
    const redis = container.resolve('Redis');
    return new CacheService(redis);
  });
  container.register('PluginLoader', () => new PluginLoader());
  container.register('ExternalServiceProxy', () => new ExternalServiceProxy());
  container.register('ArchitectureValidator', () => new ArchitectureValidator());

  // --- Validate DI graph ---
  const validator = container.resolve<ArchitectureValidator>('ArchitectureValidator');
  await validator.validateOnStartup(
    container.getRegisteredTokens(),
    () => [], // In real impl: resolve actual deps
  );

  // --- Register modules ---
  const db = container.resolve('Database');
  const eventBus = container.resolve<EventBus>('EventBus');
  const schemaRegistry = container.resolve<EventSchemaRegistry>('EventSchemaRegistry');

  const productModule = new ProductModule({ db, eventBus, schemaRegistry });
  productModule.registerRoutes(app);

  // --- Register plugins ---
  const pluginLoader = container.resolve<PluginLoader>('PluginLoader');
  const analyticsPlugin = new AnalyticsPlugin();
  await pluginLoader.register(analyticsPlugin);
  await pluginLoader.activate('analytics');

  // --- Health check ---
  app.get('/health/liveness', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/health/readiness', async (_req, res) => {
    // In real implementation: check DB, Redis, RabbitMQ
    res.json({
      status: 'ok',
      checks: [
        { name: 'database', ok: true },
        { name: 'redis', ok: true },
        { name: 'rabbitmq', ok: true },
      ],
    });
  });

  // --- Global error handler ---
  app.use(globalErrorHandler as express.ErrorRequestHandler);

  // --- Start server ---
  app.listen(config.port, () => {
    console.log(`ERP Backend running on port ${config.port}`);
    console.log(`Health check: http://localhost:${config.port}/health/readiness`);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
