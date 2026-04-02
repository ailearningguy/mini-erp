import type { IModule } from '@core/di/container';
import type { IProductService } from './interfaces/product.service.interface';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import {
  ProductCreatedEventSchema,
  ProductUpdatedEventSchema,
  ProductDeactivatedEventSchema,
} from './events/product.events';
import type { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import type { EventBus } from '@core/event-bus/event-bus';
import type { EventConsumer } from '@core/consumer/consumer';
import type { CacheService } from '@core/cache/cache.service';
import type { Express } from 'express';
import type { Db } from '@shared/types/db';

interface ProductModuleConfig {
  db: Db;
  eventBus: EventBus;
  schemaRegistry: EventSchemaRegistry;
  eventConsumer: EventConsumer;
  cacheService: CacheService;
  app: Express;
}

class ProductModule implements IModule {
  readonly name = 'product';
  private service: IProductService;
  private controller: ProductController;

  constructor(private readonly config: ProductModuleConfig) {
    this.service = new ProductService(config.db, config.eventBus);
    this.controller = new ProductController(this.service);
  }

  getService(): IProductService {
    return this.service;
  }

  async onInit(): Promise<void> {
    this.config.schemaRegistry.register('product.created.v1', ProductCreatedEventSchema);
    this.config.schemaRegistry.register('product.updated.v1', ProductUpdatedEventSchema);
    this.config.schemaRegistry.register('product.deactivated.v1', ProductDeactivatedEventSchema);

    this.config.app.get('/api/v1/products', (req, res, next) => this.controller.list(req, res, next));
    this.config.app.get('/api/v1/products/:id', (req, res, next) => this.controller.getById(req, res, next));
    this.config.app.post('/api/v1/products', (req, res, next) => this.controller.create(req, res, next));
    this.config.app.put('/api/v1/products/:id', (req, res, next) => this.controller.update(req, res, next));
    this.config.app.delete('/api/v1/products/:id', (req, res, next) => this.controller.delete(req, res, next));

    this.config.eventConsumer.registerHandler('product.updated.v1', async (event) => {
      await this.config.cacheService.invalidate(`product:${event.aggregate_id}`);
    });
    this.config.eventConsumer.registerHandler('product.deactivated.v1', async (event) => {
      await this.config.cacheService.invalidate(`product:${event.aggregate_id}`);
    });
  }

  async onDestroy(): Promise<void> {
  }
}

export { ProductModule };
export type { ProductModuleConfig };