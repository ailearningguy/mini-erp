import type { IModule } from '@core/di/container';

class OrderModule implements IModule {
  readonly name = 'order';

  async onInit(): Promise<void> {
  }

  async onDestroy(): Promise<void> {
  }
}

export { OrderModule };