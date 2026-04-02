import type { IModule } from '@core/di/container';
import type { IOrderService } from './interfaces/order.service.interface';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import {
  OrderCreatedEventSchema,
  OrderConfirmedEventSchema,
  OrderCancelledEventSchema,
} from './events/order.events';
import type { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import type { EventBus } from '@core/event-bus/event-bus';
import type { IInventoryService } from '@modules/inventory/interfaces/inventory.service.interface';
import { SagaOrchestrator } from '@core/saga/saga-orchestrator';
import type { HookExecutor } from '@core/hooks/hook-executor';
import type { Express } from 'express';
import type { Db } from '@shared/types/db';

interface OrderModuleConfig {
  db: Db;
  eventBus: EventBus;
  schemaRegistry: EventSchemaRegistry;
  inventoryService: IInventoryService;
  sagaOrchestrator: SagaOrchestrator;
  hookExecutor: HookExecutor;
  app: Express;
}

class OrderModule implements IModule {
  readonly name = 'order';
  private service: IOrderService;
  private controller: OrderController;

  constructor(private readonly config: OrderModuleConfig) {
    this.service = new OrderService(
      config.db,
      config.eventBus,
      config.inventoryService,
      config.sagaOrchestrator,
      config.hookExecutor,
    );
    this.controller = new OrderController(this.service);
  }

  getService(): IOrderService {
    return this.service;
  }

  async onInit(): Promise<void> {
    this.config.schemaRegistry.register('order.created.v1', OrderCreatedEventSchema);
    this.config.schemaRegistry.register('order.confirmed.v1', OrderConfirmedEventSchema);
    this.config.schemaRegistry.register('order.cancelled.v1', OrderCancelledEventSchema);

    this.config.app.get('/api/v1/orders', (req, res, next) => this.controller.list(req, res, next));
    this.config.app.get('/api/v1/orders/:id', (req, res, next) => this.controller.getById(req, res, next));
    this.config.app.post('/api/v1/orders', (req, res, next) => this.controller.create(req, res, next));
  }

  async onDestroy(): Promise<void> {
  }
}

export { OrderModule };
export type { OrderModuleConfig };