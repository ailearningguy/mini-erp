import type { ModuleFactory, ModuleDefinition, DIContainer } from '@core/di/container';
import { OrderModule } from './order.module';

const orderModuleFactory: ModuleFactory = {
  async create(container: DIContainer): Promise<ModuleDefinition> {
    void container;
    const module = new OrderModule();

    return {
      module,
      providers: [],
      exports: [],
    };
  },
};

export default orderModuleFactory;