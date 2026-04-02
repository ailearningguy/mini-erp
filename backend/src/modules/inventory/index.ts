import type { ModuleFactory, ModuleDefinition, DIContainer } from '@core/di/container';
import { InventoryModule } from './inventory.module';
import type { Db } from '@shared/types/db';
import type { EventBus } from '@core/event-bus/event-bus';
import type { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import type { Express } from 'express';

const inventoryModuleFactory: ModuleFactory = {
  async create(container: DIContainer): Promise<ModuleDefinition> {
    const db = container.get<Db>('Database');
    const eventBus = container.get<EventBus>('EventBus');
    const schemaRegistry = container.get<EventSchemaRegistry>('EventSchemaRegistry');
    const app = container.get<Express>('ExpressApp');

    const module = new InventoryModule({ db, eventBus, schemaRegistry, app });

    return {
      module,
      providers: [
        {
          token: 'IInventoryService',
          useFactory: () => module.getService(),
          moduleName: 'inventory',
          exported: true,
        },
      ],
      exports: ['IInventoryService'],
    };
  },
};

export default inventoryModuleFactory;