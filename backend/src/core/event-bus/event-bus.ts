import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@shared/types/event';
import type { IEventBus } from './event-bus.interface';
import { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import { OutboxRepository } from '@core/outbox/outbox.repository';
import type { Db } from '@shared/types/db';

class EventBus implements IEventBus {
  constructor(
    private readonly outboxRepo: OutboxRepository,
    private readonly schemaRegistry: EventSchemaRegistry,
  ) {}

  async emit<T extends Record<string, unknown>>(
    event: Omit<EventEnvelope<T>, 'id' | 'timestamp'>,
    tx: Db,
  ): Promise<EventEnvelope<T>> {
    if (!tx) {
      throw new Error(
        'EventBus.emit() requires a transaction parameter. '
        + 'Events MUST be written to outbox within the same DB transaction as domain data.',
      );
    }

    const fullEvent: EventEnvelope<T> = {
      ...event,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    } as EventEnvelope<T>;

    this.schemaRegistry.validate(fullEvent.type, fullEvent);

    await this.outboxRepo.insert(fullEvent, tx);

    return fullEvent;
  }
}

export { EventBus };