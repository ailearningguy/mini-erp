import express from 'express';
import helmet from 'helmet';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import Redis from 'ioredis';
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
import { requestIdMiddleware, snakeCaseMiddleware, snakeCaseResponseMiddleware, globalErrorHandler } from '@core/api/response';
import { authMiddleware } from '@core/auth/auth.middleware';
import { createIdempotencyMiddleware } from '@core/idempotency/idempotency.middleware';
import { ApiIdempotencyStore } from '@core/idempotency/api-idempotency';
import { createRateLimiter } from '@core/api/rate-limiter';
import { API_CONSTANTS } from '@shared/constants';
import { logger } from '@core/logging/logger';

type AnyDb = Record<string, unknown>;

async function bootstrap(): Promise<void> {
  const config = loadConfig();

  const app = express();

  // --- Middleware ---
  app.use(helmet());
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use(snakeCaseMiddleware);
  app.use(snakeCaseResponseMiddleware);

  // --- DI Container ---
  const container = new DIContainer();

  container.register('Config', () => config);
  container.register('EventSchemaRegistry', () => new EventSchemaRegistry());
  container.register('Database', () => {
    const pool = new pg.Pool({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.name,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    return drizzle(pool);
  });
  container.register('Redis', () => {
    const redis = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
    redis.on('error', (err) => logger.error({ err }, 'Redis connection error'));
    return redis;
  });
  container.register('OutboxRepository', () => {
    const db = container.resolve<AnyDb>('Database');
    return new OutboxRepository(db);
  }, ['Database']);
  container.register('EventBus', () => {
    const outboxRepo = container.resolve<OutboxRepository>('OutboxRepository');
    const schemaRegistry = container.resolve<EventSchemaRegistry>('EventSchemaRegistry');
    return new EventBus(outboxRepo, schemaRegistry);
  }, ['OutboxRepository', 'EventSchemaRegistry']);
  container.register('EventRateLimiter', () => new EventRateLimiter(defaultEventRateLimits));
  container.register('ProcessedEventStore', () => {
    const db = container.resolve<AnyDb>('Database');
    return new ProcessedEventStore(db);
  }, ['Database']);
  container.register('EventConsumer', () => {
    const processedStore = container.resolve<ProcessedEventStore>('ProcessedEventStore');
    const schemaRegistry = container.resolve<EventSchemaRegistry>('EventSchemaRegistry');
    const rateLimiter = container.resolve<EventRateLimiter>('EventRateLimiter');
    return new EventConsumer(
      processedStore,
      schemaRegistry,
      rateLimiter,
      (fn) => (container.resolve<AnyDb>('Database') as any).transaction(fn),
    );
  }, ['ProcessedEventStore', 'EventSchemaRegistry', 'EventRateLimiter', 'Database']);
  container.register('CacheService', () => {
    const redis = container.resolve('Redis');
    return new CacheService(redis as ConstructorParameters<typeof CacheService>[0]);
  }, ['Redis']);
  container.register('PluginLoader', () => new PluginLoader());
  container.register('ExternalServiceProxy', () => new ExternalServiceProxy());
  container.register('ArchitectureValidator', () => new ArchitectureValidator());

  // --- Validate DI graph ---
  const validator = container.resolve<ArchitectureValidator>('ArchitectureValidator');
  await validator.validateOnStartup(
    container.getRegisteredTokens(),
    (token) => container.getDependencies(token),
  );

  // --- Rate limiter (before auth) ---
  app.use(createRateLimiter(
    API_CONSTANTS.DEFAULT_RATE_LIMIT_MAX_REQUESTS,
    API_CONSTANTS.DEFAULT_RATE_LIMIT_WINDOW_MS,
  ));

  // --- Idempotency (before auth) ---
  const redis = container.resolve<Redis>('Redis');
  const idempotencyStore = new ApiIdempotencyStore(redis as any);
  app.use(createIdempotencyMiddleware(idempotencyStore));

  // --- Auth (after rate limiter + idempotency) ---
  app.use('/api', authMiddleware(config));

  // --- Register modules ---
  const db = container.resolve<AnyDb>('Database');
  const eventBus = container.resolve<EventBus>('EventBus');
  const schemaRegistry = container.resolve<EventSchemaRegistry>('EventSchemaRegistry');

  const productModule = new ProductModule({ db, eventBus, schemaRegistry });
  productModule.registerRoutes(app);

  // --- Register plugins ---
  const pluginLoader = container.resolve<PluginLoader>('PluginLoader');
  const analyticsPlugin = new AnalyticsPlugin();
  analyticsPlugin.init(db);
  await pluginLoader.register(analyticsPlugin);
  await pluginLoader.activate('analytics');

  const analyticsModule = analyticsPlugin.getModule();
  if (analyticsModule) {
    analyticsModule.registerRoutes(app);
  }

  const eventConsumer = container.resolve<EventConsumer>('EventConsumer');
  analyticsPlugin.setEventConsumer(eventConsumer);

  // --- Health check ---
  app.get('/health/liveness', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/health/readiness', async (_req, res) => {
    const checks = [];

    try {
      await (db as any).execute('SELECT 1');
      checks.push({ name: 'database', ok: true });
    } catch {
      checks.push({ name: 'database', ok: false });
    }

    try {
      const redisClient = container.resolve<Redis>('Redis');
      await redisClient.ping();
      checks.push({ name: 'redis', ok: true });
    } catch {
      checks.push({ name: 'redis', ok: false });
    }

    const allOk = checks.every((c) => c.ok);
    res.status(allOk ? 200 : 503).json({ status: allOk ? 'ok' : 'degraded', checks });
  });

  // --- Global error handler ---
  app.use(globalErrorHandler as express.ErrorRequestHandler);

  // --- Start server ---
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'ERP Backend started');
    logger.info({ url: `http://localhost:${config.port}/health/readiness` }, 'Health check available');
  });

  // --- Graceful shutdown ---
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Graceful shutdown initiated');

    server.close(async () => {
      logger.info('HTTP server closed');

      try {
        const pool = (db as any).$client;
        if (pool) await pool.end();
        logger.info('Database pool closed');
      } catch (e) {
        logger.error({ err: e }, 'Error closing database pool');
      }

      try {
        const redisClient = container.resolve<any>('Redis');
        await redisClient.quit();
        logger.info('Redis connection closed');
      } catch (e) {
        logger.error({ err: e }, 'Error closing Redis');
      }

      process.exit(0);
    });

    setTimeout(() => {
      logger.fatal('Forced shutdown after timeout');
      process.exit(1);
    }, 30_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start application');
  process.exit(1);
});
