import type { IModule } from '@core/di/container';
import type { IInventoryService } from './interfaces/inventory.service.interface';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import {
  InventoryReservedEventSchema,
  InventoryReleasedEventSchema,
  InventoryAdjustedEventSchema,
} from './events/inventory.events';
import type { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import type { EventBus } from '@core/event-bus/event-bus';
import type { Express } from 'express';
import type { Db } from '@shared/types/db';

interface InventoryModuleConfig {
  db: Db;
  eventBus: EventBus;
  schemaRegistry: EventSchemaRegistry;
  app: Express;
}

class InventoryModule implements IModule {
  readonly name = 'inventory';
  private service: IInventoryService;
  private controller: InventoryController;

  constructor(private readonly config: InventoryModuleConfig) {
    this.service = new InventoryService(config.db, config.eventBus);
    this.controller = new InventoryController(this.service);
  }

  getService(): IInventoryService {
    return this.service;
  }

  async onInit(): Promise<void> {
    this.config.schemaRegistry.register('inventory.reserved.v1', InventoryReservedEventSchema);
    this.config.schemaRegistry.register('inventory.released.v1', InventoryReleasedEventSchema);
    this.config.schemaRegistry.register('inventory.adjusted.v1', InventoryAdjustedEventSchema);

    this.config.app.get('/api/v1/inventory/:productId', (req, res, next) => this.controller.getByProductId(req, res, next));
    this.config.app.put('/api/v1/inventory/adjust', (req, res, next) => this.controller.adjust(req, res, next));
  }

  async onDestroy(): Promise<void> {
  }
}

export { InventoryModule };
export type { InventoryModuleConfig };