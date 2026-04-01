import type { IPlugin, PluginMetadata, PluginPermission } from '@core/plugin-system/plugin-loader';
import type { EventEnvelope } from '@shared/types/event';
import { AnalyticsModule } from './analytics.module';
import type { AnalyticsService } from './analytics.service';
import { createChildLogger } from '@core/logging/logger';

const log = createChildLogger({ plugin: 'analytics' });

type AnyDb = Record<string, unknown>;

const analyticsPermissions: PluginPermission[] = [
  { resource: 'product', actions: ['read'] },
  { resource: 'order', actions: ['read'] },
  { resource: 'external:email', actions: ['call'] },
  { resource: 'plugin_analytics_*', actions: ['read', 'write'] },
];

class AnalyticsPlugin implements IPlugin {
  private module: AnalyticsModule | null = null;

  getMetadata(): PluginMetadata {
    return {
      name: 'analytics',
      version: '2026.04.01',
      description: 'Tracks domain events for analytics dashboards',
      author: 'ERP Team',
      enabled: true,
      trusted: true,
      permissions: analyticsPermissions,
      config: {
        trackedEvents: [
          'product.created.v1',
          'product.updated.v1',
          'order.created.v1',
          'order.completed.v1',
        ],
      },
    };
  }

  init(db: AnyDb): void {
    this.module = new AnalyticsModule(db);
  }

  getModule(): AnalyticsModule | null {
    return this.module;
  }

  getService(): AnalyticsService | null {
    return this.module?.getService() ?? null;
  }

  async onActivate(): Promise<void> {
    log.info('Plugin activated');
  }

  async onDeactivate(): Promise<void> {
    log.info('Plugin deactivated');
  }

  async onInstall(): Promise<void> {
    log.info('Plugin installed');
  }

  async onUninstall(): Promise<void> {
    log.info('Plugin uninstalled');
  }

  async dispose(): Promise<void> {
    log.info('Plugin disposed');
  }

  isActive(): boolean {
    return this.module !== null;
  }

  setEventConsumer(consumer: { on(eventType: string, handler: (event: EventEnvelope, tx: Record<string, unknown>) => Promise<void>): void }): void {
    const metadata = this.getMetadata();
    const trackedEvents: string[] = (metadata.config?.trackedEvents as string[]) ?? [];
    const service = this.getService();

    for (const eventType of trackedEvents) {
      consumer.on(eventType, async (event: EventEnvelope, _tx: Record<string, unknown>) => {
        if (service) {
          await service.recordEvent(event);
        }
      });
    }
  }
}

export { AnalyticsPlugin };