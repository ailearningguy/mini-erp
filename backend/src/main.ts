import express from 'express';
import helmet from 'helmet';
import * as path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import Redis from 'ioredis';
import { loadConfig } from '@core/config/config';
import { DIContainer } from '@core/di/container';
import { EventBus } from '@core/event-bus/event-bus';
import type { IEventBus } from '@core/event-bus/event-bus.interface';
import { OutboxRepository } from '@core/outbox/outbox.repository';
import { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import { EventRateLimiter } from '@core/consumer/rate-limiter';
import { ProcessedEventStore } from '@core/consumer/processed-event.schema';
import { EventConsumer } from '@core/consumer/consumer';
import { AmqpConsumer } from '@core/consumer/amqp-consumer';
import { PluginLoader, PluginGuard } from '@core/plugin-system/plugin-loader';
import { ExternalServiceProxy } from '@core/external-integration/proxy';
import { CacheService } from '@core/cache/cache.service';
import { ArchitectureValidator } from '@core/architecture-validator/validator';
import { ModuleRegistry, FsModuleRegistry } from '@core/module-registry/registry';
import { FsPluginRegistry } from '@core/plugin-registry';
import { SchemaCollector } from '@core/schema/schema-collector';
import { SagaOrchestrator } from '@core/saga/saga-orchestrator';
import { requestIdMiddleware, snakeCaseMiddleware, snakeCaseResponseMiddleware, globalErrorHandler } from '@core/api/response';
import { authMiddleware } from '@core/auth/auth.middleware';
import { TokenRevocationService } from '@core/auth/token-revocation.service';
import { createIdempotencyMiddleware } from '@core/idempotency/idempotency.middleware';
import { ApiIdempotencyStore } from '@core/idempotency/api-idempotency';
import { createRateLimiter } from '@core/api/rate-limiter';
import { API_CONSTANTS, EVENT_CONSTANTS } from '@shared/constants';
import { logger } from '@core/logging/logger';
import { metricsService } from '@core/metrics/metrics.service';
import { createMetricsHandler } from '@core/metrics/metrics-endpoint';
import { QueueManager } from '@core/jobs/queue-manager';
import { TrafficGate } from '@core/traffic/traffic-gate';
import { RequestTracker } from '@core/traffic/request-tracker';
import { SystemStateManager } from '@core/restart/system-state';
import { SoftRestartManager } from '@core/restart/soft-restart-manager';
import { ModuleInstaller } from '@core/module-installer/module-installer';
import { createModuleRoutes } from '@core/module-installer/module.routes';
import type { Db } from '@shared/types/db';
import { HookRegistry, HookExecutor, detectHookConflicts } from '@core/hooks';
import { CapabilityExecutor, validateCapabilities } from '@core/capability';
import { CapabilityGovernanceRegistry, checkDeprecations } from '@core/capability-governance';

async function bootstrap(): Promise<void> {
  const config = loadConfig();

  const app = express();

  // --- Middleware ---
  app.use(helmet());
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use(snakeCaseMiddleware);
  app.use(snakeCaseResponseMiddleware);

  // --- Traffic Control for soft restart ---
  const trafficGate = new TrafficGate();
  const requestTracker = new RequestTracker();
  const systemStateManager = new SystemStateManager();

  app.use(trafficGate.middleware);
  app.use(requestTracker.middleware);

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
    const db = container.resolve<Db>('Database');
    return new OutboxRepository(db);
  }, ['Database']);
  container.register('ModuleRegistry', () => new ModuleRegistry());
  container.registerCore('ExpressApp', { useFactory: () => app });
  container.registerCore('FsModuleRegistry', {
    useFactory: () => new FsModuleRegistry(path.join(__dirname, 'modules'), logger),
  });
  container.registerCore('HookRegistry', {
    useFactory: () => new HookRegistry(),
  });
  container.registerCore('HookExecutor', {
    useFactory: (c) => new HookExecutor(c.get('HookRegistry'), logger),
    deps: ['HookRegistry'],
  });
  container.registerCore('CapabilityGovernanceRegistry', {
    useFactory: () => new CapabilityGovernanceRegistry(),
  });
  container.registerCore('CapabilityRegistry', {
    useFactory: (c) => c.get('CapabilityGovernanceRegistry'),
  });
  container.registerCore('CapabilityExecutor', {
    useFactory: (c) => new CapabilityExecutor(
      c.get('CapabilityGovernanceRegistry'),
      logger,
    ),
    deps: ['CapabilityGovernanceRegistry'],
  });
  container.register('EventBus', () => {
    const outboxRepo = container.resolve<OutboxRepository>('OutboxRepository');
    const schemaRegistry = container.resolve<EventSchemaRegistry>('EventSchemaRegistry');
    return new EventBus(outboxRepo, schemaRegistry);
  }, ['OutboxRepository', 'EventSchemaRegistry']);
  container.register('IEventBus', () => container.resolve<EventBus>('EventBus'), ['EventBus']);
  container.register('ProcessedEventStore', () => {
    const db = container.resolve<Db>('Database');
    return new ProcessedEventStore(db);
  }, ['Database']);
  container.register('EventRateLimiter', () => {
    return new EventRateLimiter([]);
  });
  container.register('EventConsumer', () => {
    const processedStore = container.resolve<ProcessedEventStore>('ProcessedEventStore');
    const schemaRegistry = container.resolve<EventSchemaRegistry>('EventSchemaRegistry');
    const rateLimiter = container.resolve<EventRateLimiter>('EventRateLimiter');
    return new EventConsumer(
      processedStore,
      schemaRegistry,
      rateLimiter,
      (fn) => container.resolve<Db>('Database').transaction(fn),
    );
  }, ['ProcessedEventStore', 'EventSchemaRegistry', 'EventRateLimiter', 'Database']);
  container.register('CacheService', () => {
    const redis = container.resolve('Redis');
    return new CacheService(redis as ConstructorParameters<typeof CacheService>[0]);
  }, ['Redis']);
  container.register('PluginLoader', () => new PluginLoader());
  container.register('ExternalServiceProxy', () => new ExternalServiceProxy(new PluginGuard()));
  container.register('ArchitectureValidator', () => new ArchitectureValidator());

  // --- Validate DI graph (before module/plugin registration) ---
  const validator = container.resolve<ArchitectureValidator>('ArchitectureValidator');

  // Build dependency graph from registered DI tokens
  const tokens = container.getRegisteredTokens();
  const graphNodes = tokens.map((t) => t.toLowerCase());
  const graphEdges: { from: string; to: string }[] = [];
  for (const token of tokens) {
    const deps = container.getDependencies(token);
    for (const dep of deps) {
      graphEdges.push({ from: token.toLowerCase(), to: dep.toLowerCase() });
    }
  }

  // Early validation before modules/plugins are registered
  await validator.validateOnStartup(
    container.getRegisteredTokens(),
    (token) => container.getDependencies(token),
    {
      dependencyGraph: { nodes: graphNodes, edges: graphEdges },
      plugins: [],
      serviceBindings: [],
    },
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

  // --- QueueManager for background jobs ---
  const queueManager = new QueueManager(redis);
  logger.info('QueueManager initialized');

  // --- TokenRevocationService ---
  const tokenRevocationService = new TokenRevocationService(redis as any);

  // --- Auth (after rate limiter + idempotency) ---
  app.use('/api', authMiddleware(config, tokenRevocationService));

  // --- Register modules via FsModuleRegistry ---
  const fsRegistry = container.get<FsModuleRegistry>('FsModuleRegistry');
  await fsRegistry.refresh();
  await container.build(fsRegistry.getActive());

  const hookRegistry = container.get<HookRegistry>('HookRegistry');
  detectHookConflicts(hookRegistry.getAllHooks());

  const capabilityRegistry = container.get<CapabilityGovernanceRegistry>('CapabilityGovernanceRegistry');
  validateCapabilities(capabilityRegistry);
  checkDeprecations(capabilityRegistry.getAllContracts());

  // --- Schema Collector ---
  const schemaCollector = new SchemaCollector();

  // Collect module schemas from container build
  // (modules export schemas via ModuleDefinition.schemas)

  // --- Auto-discover and register plugins ---
  const fsPluginRegistry = new FsPluginRegistry(
    path.join(__dirname, 'plugins'),
    logger,
  );
  container.registerCore('FsPluginRegistry', {
    useFactory: () => fsPluginRegistry,
  });

  await fsPluginRegistry.refresh();

  const pluginLoader = container.resolve<PluginLoader>('PluginLoader');

  for (const pluginMeta of fsPluginRegistry.getActive()) {
    const factory = await pluginMeta.entry();
    const pluginDef = await factory.default.create(container);

    await pluginLoader.register(pluginDef.plugin);
    await pluginLoader.activate(pluginMeta.name);

    if (pluginDef.routes) {
      pluginDef.routes(app);
    }

    if (pluginDef.schemas) {
      schemaCollector.collect(pluginDef.schemas, `plugin:${pluginMeta.name}`);
    }

    if (pluginDef.hooks) {
      for (const hook of pluginDef.hooks) {
        hookRegistry.register(hook);
      }
    }

    if (pluginDef.eventHandlers) {
      const eventConsumer = container.resolve<EventConsumer>('EventConsumer');
      for (const { eventType, handler } of pluginDef.eventHandlers) {
        eventConsumer.registerHandler(eventType, handler);
      }
    }
  }

  // --- Validate architecture with real plugins after registration ---
  const activePlugins = pluginLoader.getActivePlugins().map(name => {
    const reg = (pluginLoader as any).plugins.get(name);
    if (!reg) return null;
    const metadata = reg.metadata;
    return {
      name: metadata.name,
      permissions: metadata.permissions ?? [],
      activatedAt: new Date(),
    };
  }).filter(Boolean);

  const registeredTokens = container.getRegisteredTokens();
  const serviceBindings = registeredTokens
    .filter(t => t.startsWith('I') && t[1] === t[1].toUpperCase())
    .map(t => ({ token: t, implementation: t.replace('I', '').replace(/Service$/, ''), isInterface: true }));

  const finalGraphNodes = registeredTokens.map((t) => t.toLowerCase());
  const finalGraphEdges: { from: string; to: string }[] = [];
  for (const token of registeredTokens) {
    const deps = container.getDependencies(token);
    for (const dep of deps) {
      finalGraphEdges.push({ from: token.toLowerCase(), to: dep.toLowerCase() });
    }
  }

  const validationResult = await validator.validateOnStartup(
    registeredTokens,
    (token) => container.getDependencies(token),
    {
      dependencyGraph: { nodes: finalGraphNodes, edges: finalGraphEdges },
      plugins: activePlugins,
      serviceBindings: serviceBindings,
    },
  );

  if (!validationResult.valid) {
    logger.warn({ errors: validationResult.errors }, 'Architecture validation warnings');
  }

  const eventConsumer = container.resolve<EventConsumer>('EventConsumer');
  const db = container.resolve<Db>('Database');

  // --- Wire Saga Orchestrator ---
  const sagaOrchestrator = new SagaOrchestrator(db);
  logger.info('SagaOrchestrator initialized');

  const amqpConsumer = new AmqpConsumer(eventConsumer, {
    rabbitmqUrl: config.rabbitmq.url,
    exchange: EVENT_CONSTANTS.EXCHANGE_NAME,
    queue: 'erp.main.consumer',
    prefetchCount: EVENT_CONSTANTS.CONSUMER_PREFETCH_COUNT,
  });

  await amqpConsumer.connect();
  await amqpConsumer.start();

  // --- SoftRestartManager ---
  // pluginLoader already resolved at line 193
  const softRestartManager = new SoftRestartManager(
    trafficGate,
    requestTracker,
    pluginLoader,
    container,
    amqpConsumer,
    queueManager,
    logger,
  );
  logger.info('SoftRestartManager initialized');

  // --- Module Installer & Routes ---
  const moduleInstaller = new ModuleInstaller(
    fsRegistry,
    softRestartManager,
    path.join(__dirname, 'modules'),
    logger,
  );
  app.use('/api/v1', createModuleRoutes(moduleInstaller));
  logger.info('ModuleInstaller and routes initialized');

  // --- Health check ---
  app.get('/health/liveness', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/health/readiness', async (_req, res) => {
    const systemState = systemStateManager.getState();

    if (systemState === 'RESTARTING') {
      return res.status(503).json({
        status: 'restarting',
        system_state: systemState,
      });
    }

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

  // --- Metrics endpoint ---
  app.get('/metrics', createMetricsHandler(metricsService));

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
        await queueManager.closeAll();
        logger.info('BullMQ queues closed');
      } catch (e) {
        logger.error({ err: e }, 'Error closing BullMQ queues');
      }

      try {
        const redisClient = container.resolve<any>('Redis');
        await redisClient.quit();
        logger.info('Redis connection closed');
      } catch (e) {
        logger.error({ err: e }, 'Error closing Redis');
      }

      try {
        await amqpConsumer.shutdown();
        logger.info('AMQP consumer closed');
      } catch (e) {
        logger.error({ err: e }, 'Error closing AMQP consumer');
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
