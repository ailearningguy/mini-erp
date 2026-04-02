import type { ModuleFactory, ModuleDefinition, DIContainer } from '@core/di/container';
import { ProductModule } from './product.module';
import type { Db } from '@shared/types/db';
import type { EventBus } from '@core/event-bus/event-bus';
import type { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import type { EventConsumer } from '@core/consumer/consumer';
import type { CacheService } from '@core/cache/cache.service';
import type { Express } from 'express';
import {
  pricingCapability,
  basePriceHandler,
  roundingHandler,
  finalPriceHandler,
} from './capabilities/pricing.capability';

const productModuleFactory: ModuleFactory = {
  async create(container: DIContainer): Promise<ModuleDefinition> {
    const db = container.get<Db>('Database');
    const eventBus = container.get<EventBus>('EventBus');
    const schemaRegistry = container.get<EventSchemaRegistry>('EventSchemaRegistry');
    const eventConsumer = container.get<EventConsumer>('EventConsumer');
    const cacheService = container.get<CacheService>('CacheService');
    const app = container.get<Express>('ExpressApp');

    const module = new ProductModule({
      db,
      eventBus,
      schemaRegistry,
      eventConsumer,
      cacheService,
      app,
    });

    return {
      module,
      providers: [
        {
          token: 'IProductService',
          useFactory: () => module.getService(),
          moduleName: 'product',
          exported: true,
        },
      ],
      exports: ['IProductService'],
      capabilities: [basePriceHandler, roundingHandler, finalPriceHandler],
    };
  },
};

export default productModuleFactory;
export { pricingCapability };