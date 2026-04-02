import type { ModuleFactory, ModuleDefinition, DIContainer } from '@core/di/container';
import { OrderModule } from './order.module';
import type { IInventoryService } from '@modules/inventory/interfaces/inventory.service.interface';
import type { Db } from '@shared/types/db';
import type { EventBus } from '@core/event-bus/event-bus';
import type { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import { SagaOrchestrator } from '@core/saga/saga-orchestrator';
import type { HookExecutor } from '@core/hooks/hook-executor';
import type { Express } from 'express';

const orderModuleFactory: ModuleFactory = {
  async create(container: DIContainer): Promise<ModuleDefinition> {
    const db = container.get<Db>('Database');
    const eventBus = container.get<EventBus>('EventBus');
    const schemaRegistry = container.get<EventSchemaRegistry>('EventSchemaRegistry');
    const inventoryService = container.get<IInventoryService>('IInventoryService');
    const sagaOrchestrator = container.get<SagaOrchestrator>('SagaOrchestrator');
    const hookExecutor = container.get<HookExecutor>('HookExecutor');
    const app = container.get<Express>('ExpressApp');

    const module = new OrderModule({
      db,
      eventBus,
      schemaRegistry,
      inventoryService,
      sagaOrchestrator,
      hookExecutor,
      app,
    });

    return {
      module,
      providers: [
        {
          token: 'IOrderService',
          useFactory: () => module.getService(),
          moduleName: 'order',
          exported: true,
        },
      ],
      exports: ['IOrderService'],
      hooks: [
        {
          point: 'order.beforeCreate',
          phase: 'pre',
          handler: async (ctx) => {
            if (!ctx.data.items || ctx.data.items.length === 0) {
              ctx.data.rejected = true;
            }
          },
          module: 'order',
          priority: 100,
        },
        {
          point: 'order.afterCreate',
          phase: 'post',
          handler: async (ctx) => {
            console.log(`Order created: ${ctx.data.id}`);
          },
          module: 'order',
          priority: 100,
          failSafe: true,
        },
      ],
    };
  },
};

export default orderModuleFactory;