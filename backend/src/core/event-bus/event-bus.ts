import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@shared/types/event';
import { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import { OutboxRepository } from '@core/outbox/outbox.repository';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

interface Transaction {
  // Drizzle transaction type — simplified for skeleton
  [key: string]: unknown;
}

class EventBus {
  constructor(
    private readonly outboxRepo: OutboxRepository,
    private readonly schemaRegistry: EventSchemaRegistry,
  ) {}

  async emit<T extends Record<string, unknown>>(
    event: Omit<EventEnvelope<T>, 'id' | 'timestamp'>,
    tx: PostgresJsDatabase<Record<string, unknown>> | Transaction,
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
