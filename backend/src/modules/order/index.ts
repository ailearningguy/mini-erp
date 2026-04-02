import type { ModuleFactory, ModuleDefinition, DIContainer } from '@core/di/container';
import { OrderModule } from './order.module';
import type { IInventoryService } from '@modules/inventory/interfaces/inventory.service.interface';
import type { Db } from '@shared/types/db';
import type { IEventBus } from '@core/event-bus/event-bus.interface';
import type { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import type { ISagaOrchestrator } from '@core/saga/saga-orchestrator.interface';
import type { IHookExecutor } from '@core/hooks/hook-executor.interface';
import type { Express } from 'express';

const orderModuleFactory: ModuleFactory = {
  async create(container: DIContainer): Promise<ModuleDefinition> {
    const db = container.get<Db>('Database');
    const eventBus = container.get<IEventBus>('IEventBus');
    const schemaRegistry = container.get<EventSchemaRegistry>('EventSchemaRegistry');
    const inventoryService = container.get<IInventoryService>('IInventoryService');
    const sagaOrchestrator = container.get<ISagaOrchestrator>('ISagaOrchestrator');
    const hookExecutor = container.get<IHookExecutor>('IHookExecutor');
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