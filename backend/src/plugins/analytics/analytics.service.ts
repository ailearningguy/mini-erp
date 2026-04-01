import { eq, gt, and, gte, lte } from 'drizzle-orm';
import { analyticsEvents } from './analytics.schema';
import type { AnalyticsQuery } from './dto/analytics-query.dto';
import type { EventEnvelope } from '@shared/types/event';
import type { AnyDb } from '@shared/types/db';

export class AnalyticsService {
  constructor(private readonly db: AnyDb) {}

  async recordEvent(event: EventEnvelope): Promise<void> {
    await (this.db as any).insert(analyticsEvents).values({
      eventType: event.type,
      aggregateId: event.aggregate_id,
      data: event.payload,
    });
  }

  async queryEvents(query: AnalyticsQuery): Promise<{ items: any[]; nextCursor: string | null }> {
    const conditions = [];

    if (query.event_type) {
      conditions.push(eq(analyticsEvents.eventType, query.event_type));
    }
    if (query.from) {
      conditions.push(gte(analyticsEvents.recordedAt, new Date(query.from)));
    }
    if (query.to) {
      conditions.push(lte(analyticsEvents.recordedAt, new Date(query.to)));
    }
    if (query.cursor) {
      conditions.push(gt(analyticsEvents.id, query.cursor));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    let qb = (this.db as any).select().from(analyticsEvents);
    if (whereClause) {
      qb = qb.where(whereClause);
    }

    const result = await qb.limit(query.limit + 1);

    const hasMore = result.length > query.limit;
    const items = hasMore ? result.slice(0, query.limit) : result;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items, nextCursor };
  }

  async getEventCount(): Promise<number> {
    const result = await (this.db as any)
      .select({ count: analyticsEvents.id })
      .from(analyticsEvents);
    return result.length;
  }
}