import { randomUUID } from 'node:crypto';
import { OutboxRepository } from './outbox.repository';
import { EVENT_CONSTANTS } from '@shared/constants';

interface AmqpChannel {
  publish(exchange: string, routingKey: string, content: Buffer, options?: Record<string, unknown>): boolean;
  assertExchange(exchange: string, type: string, options?: Record<string, unknown>): Promise<void>;
}

interface OutboxWorkerConfig {
  batchSize: number;
  pollIntervalMs: number;
  idlePollIntervalMs: number;
  lockTimeoutMs: number;
  maxProcessingAgeMs: number;
  maxConcurrent: number;
  maxRetryAttempts: number;
}

class OutboxWorker {
  private running = false;
  private activeEntries = 0;
  private immediatePoll = false;
  private workerId: string;

  constructor(
    private readonly outboxRepo: OutboxRepository,
    private readonly channel: AmqpChannel,
    private readonly config: OutboxWorkerConfig = {
      batchSize: EVENT_CONSTANTS.OUTBOX_BATCH_SIZE,
      pollIntervalMs: EVENT_CONSTANTS.OUTBOX_POLL_INTERVAL_MS,
      idlePollIntervalMs: EVENT_CONSTANTS.OUTBOX_IDLE_POLL_INTERVAL_MS,
      lockTimeoutMs: EVENT_CONSTANTS.OUTBOX_LOCK_TIMEOUT_MS,
      maxProcessingAgeMs: EVENT_CONSTANTS.OUTBOX_MAX_PROCESSING_AGE_MS,
      maxConcurrent: EVENT_CONSTANTS.OUTBOX_MAX_CONCURRENT,
      maxRetryAttempts: EVENT_CONSTANTS.OUTBOX_MAX_RETRY_ATTEMPTS,
    },
  ) {
    this.workerId = `worker-${randomUUID().slice(0, 8)}`;
  }

  async start(): Promise<void> {
    this.running = true;
    await this.channel.assertExchange(EVENT_CONSTANTS.EXCHANGE_NAME, 'topic', { durable: true });

    const staleBefore = new Date(Date.now() - this.config.lockTimeoutMs);
    const resetCount = await this.outboxRepo.resetStaleEntries(staleBefore);
    if (resetCount > 0) {
      console.log(`[OutboxWorker] Reset ${resetCount} stale entries on startup`);
    }

    await this.pollLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      if (this.immediatePoll) {
        this.immediatePoll = false;
        await this.pollAndPublish();
      }

      await this.delay(this.config.pollIntervalMs);

      if (await this.hasPendingEntries()) {
        await this.pollAndPublish();
      } else {
        await this.delay(this.config.idlePollIntervalMs);
      }
    }
  }

  private async pollAndPublish(): Promise<void> {
    if (this.activeEntries >= this.config.maxConcurrent) {
      return;
    }

    const entries = await this.outboxRepo.fetchPending(this.config.batchSize);
    if (entries.length === 0) return;

    const ids = entries.map((e) => e.id);
    await this.outboxRepo.markProcessing(ids, this.workerId);
    this.activeEntries += entries.length;

    await Promise.allSettled(
      entries.map((entry) =>
        this.processEntry(entry).finally(() => {
          this.activeEntries--;
        }),
      ),
    );
  }

  private async processEntry(entry: { id: string; eventType: string; payload: unknown; aggregateId: string }): Promise<void> {
    try {
      const published = this.channel.publish(
        EVENT_CONSTANTS.EXCHANGE_NAME,
        entry.eventType,
        Buffer.from(JSON.stringify({
          id: entry.id,
          type: entry.eventType,
          payload: entry.payload,
          aggregate_id: entry.aggregateId,
          timestamp: new Date().toISOString(),
        })),
        { persistent: true },
      );

      if (published) {
        await this.outboxRepo.markProcessed(entry.id);
      } else {
        await this.outboxRepo.markFailed(
          entry.id,
          'Channel back-pressure: publish returned false',
          this.config.maxRetryAttempts,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.outboxRepo.markFailed(entry.id, message, this.config.maxRetryAttempts);
    }
  }

  private async hasPendingEntries(): Promise<boolean> {
    const count = await this.outboxRepo.countPending();
    return count > 0;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export { OutboxWorker };
