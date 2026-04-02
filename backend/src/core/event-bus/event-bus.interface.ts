import type { EventEnvelope } from '@shared/types/event';
import type { Db } from '@shared/types/db';

interface IEventBus {
  emit<T extends Record<string, unknown>>(
    event: Omit<EventEnvelope<T>, 'id' | 'timestamp'>,
    tx: Db,
  ): Promise<EventEnvelope<T>>;
}

export type { IEventBus };
