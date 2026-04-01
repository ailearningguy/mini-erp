import { EventEmitter } from 'events';
import type { EventEnvelope } from '@shared/types/event';
import { ProcessedEventStore } from './processed-event.schema';
import { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import { EventRateLimiter } from '@core/consumer/rate-limiter';

type EventHandler = (event: EventEnvelope, tx: Record<string, unknown>) => Promise<void>;
type DbTransaction = <T>(fn: (tx: Record<string, unknown>) => Promise<T>) => Promise<T>;

class EventConsumer extends EventEmitter {
  private handlers = new Map<string, EventHandler>();
  private aggregateQueues = new Map<string, SimpleQueue>();

  constructor(
    private readonly processedEventStore: ProcessedEventStore,
    private readonly schemaRegistry: EventSchemaRegistry,
    private readonly rateLimiter: EventRateLimiter,
    private readonly dbTransaction: DbTransaction,
  ) {
    super();
  }

  registerHandler(eventType: string, handler: EventHandler): void {
    if (this.handlers.has(eventType)) {
      throw new Error(`Handler already registered for event type: ${eventType}`);
    }
    this.handlers.set(eventType, handler);
    this.emit('handler-registered', eventType);
  }

  async consume(rawMessage: unknown): Promise<void> {
    const event = this.schemaRegistry.validate(
      (rawMessage as EventEnvelope).type,
      rawMessage,
    );

    if (await this.processedEventStore.has(event.id)) {
      return;
    }

    if (!this.rateLimiter.checkLimit(event.type)) {
      throw new Error(`Rate limit exceeded for event type: ${event.type}`);
    }

    const queue = this.getOrCreateQueue(event.aggregate_id);
    await queue.add(() => this.processEvent(event));
  }

  private async processEvent(event: EventEnvelope): Promise<void> {
    const handler = this.handlers.get(event.type);
    if (!handler) {
      throw new Error(`No handler registered for event type: ${event.type}`);
    }

    await this.dbTransaction(async (tx) => {
      const alreadyProcessed = await this.processedEventStore.has(event.id, tx);
      if (alreadyProcessed) return;

      await handler(event, tx);
      await this.processedEventStore.mark(event.id, event.type, tx);
    });
    this.emit('event-processed', event);
  }

  private getOrCreateQueue(aggregateId: string): SimpleQueue {
    if (!this.aggregateQueues.has(aggregateId)) {
      this.aggregateQueues.set(aggregateId, new SimpleQueue());
    }
    return this.aggregateQueues.get(aggregateId)!;
  }
}

class SimpleQueue {
  private queue: (() => Promise<void>)[] = [];
  private running = false;

  async add(fn: () => Promise<void>): Promise<void> {
    this.queue.push(fn);
    if (!this.running) {
      await this.drain();
    }
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const fn = this.queue.shift()!;
        await fn();
      }
    } finally {
      this.running = false;
    }
  }
}

export { EventConsumer };
