import { eq, and, lte, asc, sql } from 'drizzle-orm';
import { outbox, outboxDlq } from './outbox.schema';
import type { EventEnvelope } from '@shared/types/event';
import { EVENT_CONSTANTS } from '@shared/constants';

type AnyDb = Record<string, unknown>;

class OutboxRepository {
  constructor(private readonly db: AnyDb) {}

  async insert(event: EventEnvelope, tx?: AnyDb): Promise<void> {
    const db = (tx ?? this.db) as any;
    await db.insert(outbox).values({
      eventId: event.id,
      eventType: event.type,
      source: event.source,
      aggregateId: event.aggregate_id,
      payload: event.payload,
      metadata: event.metadata,
      status: 'pending',
      attempts: 0,
    });
  }

  async fetchPending(batchSize = EVENT_CONSTANTS.OUTBOX_BATCH_SIZE): Promise<typeof outbox.$inferSelect[]> {
    return (this.db as any)
      .select()
      .from(outbox)
      .where(
        and(
          eq(outbox.status, 'pending'),
          lte(outbox.nextAttemptAt, new Date()),
        ),
      )
      .orderBy(asc(outbox.createdAt))
      .limit(batchSize)
      .for('update', { skipLocked: true });
  }

  async markProcessing(ids: string[], workerId: string): Promise<void> {
    await (this.db as any)
      .update(outbox)
      .set({
        status: 'processing',
        lockedAt: new Date(),
        lockedBy: workerId,
      })
      .where(sql`${outbox.id} = ANY(${ids})`);
  }

  async markProcessed(id: string): Promise<void> {
    await (this.db as any)
      .update(outbox)
      .set({
        status: 'processed',
        processedAt: new Date(),
      })
      .where(eq(outbox.id, id));
  }

  async markFailed(id: string, error: string, maxAttempts: number): Promise<void> {
    const entry = await (this.db as any)
      .select()
      .from(outbox)
      .where(eq(outbox.id, id))
      .limit(1);

    if (!entry[0]) return;

    const newAttempts = entry[0].attempts + 1;

    if (newAttempts >= maxAttempts) {
      await this.moveToDlq(entry[0], error);
      await (this.db as any).delete(outbox).where(eq(outbox.id, id));
    } else {
      const delay = Math.min(
        EVENT_CONSTANTS.OUTBOX_BASE_DELAY_MS * Math.pow(EVENT_CONSTANTS.OUTBOX_BACKOFF_MULTIPLIER, newAttempts - 1),
        EVENT_CONSTANTS.OUTBOX_MAX_DELAY_MS,
      );
      await (this.db as any)
        .update(outbox)
        .set({
          status: 'pending',
          attempts: newAttempts,
          nextAttemptAt: new Date(Date.now() + delay),
          lockedAt: null,
          lockedBy: null,
        })
        .where(eq(outbox.id, id));
    }
  }

  async resetStaleEntries(staleBefore: Date): Promise<number> {
    const result = await (this.db as any)
      .update(outbox)
      .set({
        status: 'pending',
        lockedAt: null,
        lockedBy: null,
      })
      .where(
        and(
          eq(outbox.status, 'processing'),
          lte(outbox.lockedAt, staleBefore),
        ),
      );
    return result.rowCount ?? 0;
  }

  async countPending(): Promise<number> {
    const result = await (this.db as any)
      .select({ count: sql<number>`count(*)` })
      .from(outbox)
      .where(eq(outbox.status, 'pending'));
    return Number(result[0]?.count ?? 0);
  }

  private async moveToDlq(entry: typeof outbox.$inferSelect, failureReason: string): Promise<void> {
    await (this.db as any).insert(outboxDlq).values({
      originalEventId: entry.eventId,
      eventType: entry.eventType,
      payload: entry.payload,
      source: entry.source,
      aggregateId: entry.aggregateId,
      failureReason,
      attempts: entry.attempts + 1,
    });
  }
}

export { OutboxRepository };
