import type { IProductService } from './interfaces/product.service.interface';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { ProductCreatedEventSchema, ProductUpdatedEventSchema } from './events/product.events';
import { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import { EventBus } from '@core/event-bus/event-bus';
import type { Express, Request, Response, NextFunction } from 'express';

type AnyDb = Record<string, unknown>;

interface ProductModuleConfig {
  db: AnyDb;
  eventBus: EventBus;
  schemaRegistry: EventSchemaRegistry;
}

class ProductModule {
  private service: IProductService;
  private controller: ProductController;

  constructor(private readonly config: ProductModuleConfig) {
    this.service = new ProductService(config.db, config.eventBus);
    this.controller = new ProductController(this.service);

    this.registerEventSchemas();
  }

  getService(): IProductService {
    return this.service;
  }

  registerRoutes(app: Express): void {
    app.get('/api/v1/products', (req, res, next) => this.controller.list(req, res, next));
    app.get('/api/v1/products/:id', (req, res, next) => this.controller.getById(req, res, next));
    app.post('/api/v1/products', (req, res, next) => this.controller.create(req, res, next));
    app.put('/api/v1/products/:id', (req, res, next) => this.controller.update(req, res, next));
    app.delete('/api/v1/products/:id', (req, res, next) => this.controller.delete(req, res, next));
  }

  private registerEventSchemas(): void {
    this.config.schemaRegistry.register('product.created.v1', ProductCreatedEventSchema);
    this.config.schemaRegistry.register('product.updated.v1', ProductUpdatedEventSchema);
  }
}

export { ProductModule };
