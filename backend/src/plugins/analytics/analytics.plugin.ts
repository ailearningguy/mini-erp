import type { IPlugin, PluginMetadata, PluginPermission } from '@core/plugin-system/plugin-loader';
import type { EventEnvelope } from '@shared/types/event';

interface AnalyticsEventRecord {
  eventType: string;
  aggregateId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

const analyticsPermissions: PluginPermission[] = [
  { resource: 'product', actions: ['read'] },
  { resource: 'order', actions: ['read'] },
  { resource: 'external:email', actions: ['call'] },
  { resource: 'plugin_analytics_*', actions: ['read', 'write'] },
];

class AnalyticsPlugin implements IPlugin {
  private events: AnalyticsEventRecord[] = [];
  private eventHandler: ((event: EventEnvelope) => void) | null = null;

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

  async onActivate(): Promise<void> {
    console.log('[AnalyticsPlugin] Activated — tracking domain events');

    this.eventHandler = (event: EventEnvelope) => {
      this.events.push({
        eventType: event.type,
        aggregateId: event.aggregate_id,
        timestamp: event.timestamp,
        data: event.payload,
      });
    };
  }

  async onDeactivate(): Promise<void> {
    console.log('[AnalyticsPlugin] Deactivated');
    this.eventHandler = null;
  }

  async onInstall(): Promise<void> {
    console.log('[AnalyticsPlugin] Installed — schema and tables created');
  }

  async onUninstall(): Promise<void> {
    this.events = [];
    this.eventHandler = null;
    console.log('[AnalyticsPlugin] Uninstalled — data cleaned up');
  }

  async dispose(): Promise<void> {
    this.eventHandler = null;
    this.events = [];
    console.log('[AnalyticsPlugin] Disposed — resources released');
  }

  isActive(): boolean {
    return this.eventHandler !== null;
  }

  getEvents(): AnalyticsEventRecord[] {
    return [...this.events];
  }

  getEventCount(): number {
    return this.events.length;
  }

  setEventConsumer(consumer: { on(eventType: string, handler: (event: EventEnvelope, tx: Record<string, unknown>) => Promise<void>): void }): void {
    const metadata = this.getMetadata();
    const trackedEvents: string[] = (metadata.config?.trackedEvents as string[]) ?? [];

    for (const eventType of trackedEvents) {
      consumer.on(eventType, async (event: EventEnvelope, _tx: Record<string, unknown>) => {
        this.events.push({
          eventType: event.type,
          aggregateId: event.aggregate_id,
          timestamp: event.timestamp,
          data: event.payload,
        });
      });
    }
  }
}

export { AnalyticsPlugin };
