import type { PluginFactory, PluginDefinition } from '@core/plugin-registry/types';
import type { DIContainer } from '@core/di/container';
import type { Db } from '@shared/types/db';
import type { EventConsumer } from '@core/consumer/consumer';
import { AnalyticsPlugin } from './analytics.plugin';
import { AnalyticsModule } from './analytics.module';
import { analyticsEvents } from './analytics.schema';
import type { Express } from 'express';
import type { EventEnvelope } from '@shared/types/event';
import { createChildLogger } from '@core/logging/logger';

const log = createChildLogger({ plugin: 'analytics' });

const analyticsPluginFactory: PluginFactory = {
  async create(container: DIContainer): Promise<PluginDefinition> {
    const db = container.get<Db>('Database');
    const eventConsumer = container.get<EventConsumer>('EventConsumer');

    const plugin = new AnalyticsPlugin(db);
    const analyticsModule = plugin.getModule();

    const trackedEvents = [
      'product.created.v1',
      'product.updated.v1',
      'order.created.v1',
      'order.completed.v1',
    ];

    const service = plugin.getService();

    return {
      plugin,
      routes: (app: Express) => {
        if (analyticsModule) {
          analyticsModule.registerRoutes(app);
        }
      },
      schemas: {
        plugin_analytics_events: analyticsEvents,
      },
      eventHandlers: trackedEvents.map((eventType) => ({
        eventType,
        handler: async (event: EventEnvelope) => {
          if (service) {
            try {
              await service.recordEvent(event);
            } catch (error) {
              log.error(
                { err: error, eventType: event.type, eventId: event.id },
                'Analytics plugin failed to record event',
              );
            }
          }
        },
      })),
    };
  },
};

export default analyticsPluginFactory;